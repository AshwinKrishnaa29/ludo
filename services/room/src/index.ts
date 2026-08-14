import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { PLAYER_COLOURS, type PlayerColour } from '@ludo/shared';
import { env, envInt, extractToken, makeVerifier } from '@ludo/kit';

const pool = new pg.Pool({ connectionString: env('DATABASE_URL') });
const verify = makeVerifier(env('JWT_SECRET'));
const GAME_URL = env('GAME_URL', 'http://localhost:4003');

const app = Fastify({ logger: { level: env('LOG_LEVEL', 'info') } });
await app.register(cookie);

app.get('/healthz', async () => ({ status: 'ok' }));
app.get('/readyz', async (_req, reply) => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ready' };
  } catch {
    return reply.code(503).send({ status: 'not_ready' });
  }
});

interface Session {
  userId: string;
  displayName: string;
}

function session(req: { headers: Record<string, unknown> }): Session {
  const token = extractToken(req.headers);
  if (!token) throw Object.assign(new Error('unauthorised'), { statusCode: 401 });
  const claims = verify(token);
  return { userId: claims.sub, displayName: claims.name };
}

function isColour(value: unknown): value is PlayerColour {
  return typeof value === 'string' && (PLAYER_COLOURS as readonly string[]).includes(value);
}

/** Six characters, no vowels, so no room code is ever an unfortunate word. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
function newCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join('');
}

app.post<{ Body: { maxPlayers?: number; colour?: string } }>('/rooms', async (req, reply) => {
  const me = session(req);
  const maxPlayers = req.body?.maxPlayers ?? 4;
  if (maxPlayers < 2 || maxPlayers > 4) {
    return reply.code(400).send({ error: 'max_players_out_of_range' });
  }
  const colour: PlayerColour = isColour(req.body?.colour) ? req.body.colour : 'red';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = crypto.randomUUID();
    // Retry on the (vanishingly unlikely) code collision rather than trusting luck.
    let code = newCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { rowCount } = await client.query('SELECT 1 FROM rooms WHERE code = $1', [code]);
      if (rowCount === 0) break;
      code = newCode();
    }

    await client.query(
      'INSERT INTO rooms (id, code, host_id, max_players) VALUES ($1, $2, $3, $4)',
      [id, code, me.userId, maxPlayers],
    );
    await client.query(
      `INSERT INTO room_seats (room_id, user_id, display_name, seat_index, colour)
       VALUES ($1, $2, $3, 0, $4)`,
      [id, me.userId, me.displayName, colour],
    );
    await client.query('COMMIT');
    return { roomId: id, code, hostId: me.userId, maxPlayers, colour };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.post<{ Params: { code: string }; Body?: { colour?: string } }>(
  '/rooms/:code/join',
  async (req, reply) => {
    const me = session(req);
    const code = req.params.code.toUpperCase();
    const wanted = isColour(req.body?.colour) ? req.body.colour : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // FOR UPDATE serialises concurrent joins so two players cannot take the
      // same seat index or the same colour.
      const { rows } = await client.query(
        'SELECT id, status, max_players FROM rooms WHERE code = $1 FOR UPDATE',
        [code],
      );
      const room = rows[0];
      if (!room) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'room_not_found' });
      }

      const existing = await client.query(
        'SELECT seat_index, colour FROM room_seats WHERE room_id = $1 AND user_id = $2',
        [room.id, me.userId],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query('COMMIT');
        return {
          roomId: room.id,
          code,
          seatIndex: existing.rows[0].seat_index,
          colour: existing.rows[0].colour,
          rejoined: true,
        };
      }

      if (room.status !== 'lobby') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'game_already_started' });
      }

      const seats = await client.query(
        'SELECT seat_index, colour FROM room_seats WHERE room_id = $1 ORDER BY seat_index',
        [room.id],
      );
      if (seats.rowCount !== null && seats.rowCount >= room.max_players) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'room_full' });
      }

      const takenSeats = new Set(seats.rows.map((r: { seat_index: number }) => r.seat_index));
      let seatIndex = 0;
      while (takenSeats.has(seatIndex)) seatIndex += 1;

      const takenColours = new Set(seats.rows.map((r: { colour: string }) => r.colour));
      const colour =
        wanted && !takenColours.has(wanted)
          ? wanted
          : PLAYER_COLOURS.find((c) => !takenColours.has(c));
      if (!colour) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'room_full' });
      }

      await client.query(
        `INSERT INTO room_seats (room_id, user_id, display_name, seat_index, colour)
         VALUES ($1, $2, $3, $4, $5)`,
        [room.id, me.userId, me.displayName, seatIndex, colour],
      );
      await client.query('COMMIT');
      return { roomId: room.id, code, seatIndex, colour, rejoined: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

/**
 * Change colour while still in the lobby. The unique constraint on
 * (room_id, colour) is what actually prevents two players ending up on the
 * same route - the check below only turns the resulting error into a useful
 * message, since two players can tap the same swatch at the same moment.
 */
app.post<{ Params: { code: string }; Body: { colour: string } }>(
  '/rooms/:code/colour',
  async (req, reply) => {
    const me = session(req);
    const code = req.params.code.toUpperCase();
    if (!isColour(req.body?.colour)) {
      return reply.code(400).send({ error: 'unknown_colour' });
    }

    const { rows } = await pool.query('SELECT id, status FROM rooms WHERE code = $1', [code]);
    const room = rows[0];
    if (!room) return reply.code(404).send({ error: 'room_not_found' });
    if (room.status !== 'lobby') {
      return reply.code(409).send({ error: 'game_already_started' });
    }

    try {
      const { rowCount } = await pool.query(
        'UPDATE room_seats SET colour = $1 WHERE room_id = $2 AND user_id = $3',
        [req.body.colour, room.id, me.userId],
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'not_in_room' });
      return { colour: req.body.colour };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'colour_taken' });
      }
      throw err;
    }
  },
);

app.get<{ Params: { code: string } }>('/rooms/:code', async (req, reply) => {
  const code = req.params.code.toUpperCase();
  const { rows } = await pool.query(
    'SELECT id, code, host_id, status, game_id, max_players FROM rooms WHERE code = $1',
    [code],
  );
  const room = rows[0];
  if (!room) return reply.code(404).send({ error: 'room_not_found' });

  const seats = await pool.query(
    `SELECT user_id, display_name, seat_index, colour
       FROM room_seats WHERE room_id = $1 ORDER BY seat_index`,
    [room.id],
  );
  return {
    roomId: room.id,
    code: room.code,
    hostId: room.host_id,
    status: room.status,
    gameId: room.game_id,
    maxPlayers: room.max_players,
    seats: seats.rows.map(
      (s: { user_id: string; display_name: string; seat_index: number; colour: string }) => ({
        userId: s.user_id,
        displayName: s.display_name,
        seatIndex: s.seat_index,
        colour: s.colour,
      }),
    ),
  };
});

/**
 * Starting a game crosses a service boundary: the room service asks the game
 * service to create the game, then records the id. If the game service call
 * fails we leave the room in `lobby` and the host can retry - the operation is
 * safe to repeat because an already-started room short-circuits above.
 */
app.post<{ Params: { code: string } }>('/rooms/:code/start', async (req, reply) => {
  const me = session(req);
  const code = req.params.code.toUpperCase();

  const { rows } = await pool.query(
    'SELECT id, host_id, status, game_id FROM rooms WHERE code = $1',
    [code],
  );
  const room = rows[0];
  if (!room) return reply.code(404).send({ error: 'room_not_found' });
  if (room.host_id !== me.userId) return reply.code(403).send({ error: 'not_host' });
  if (room.status === 'in_game') return { roomId: room.id, gameId: room.game_id };

  const seats = await pool.query(
    'SELECT user_id, display_name, colour FROM room_seats WHERE room_id = $1 ORDER BY seat_index',
    [room.id],
  );
  if (seats.rowCount === null || seats.rowCount < 2) {
    return reply.code(409).send({ error: 'need_at_least_two_players' });
  }

  const response = await fetch(`${GAME_URL}/internal/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      roomId: room.id,
      seats: seats.rows.map((s: { user_id: string; display_name: string; colour: string }) => ({
        userId: s.user_id,
        displayName: s.display_name,
        colour: s.colour,
      })),
    }),
  });
  if (!response.ok) {
    app.log.error({ status: response.status }, 'game service rejected start');
    return reply.code(502).send({ error: 'game_service_unavailable' });
  }
  const { gameId } = (await response.json()) as { gameId: string };

  await pool.query("UPDATE rooms SET status = 'in_game', game_id = $1 WHERE id = $2", [
    gameId,
    room.id,
  ]);
  return { roomId: room.id, gameId };
});

/**
 * Called by the game service when a match ends, so a finished room stops
 * pulling returning players back into a game that is over.
 */
app.post<{ Params: { roomId: string } }>('/internal/rooms/:roomId/finish', async (req) => {
  await pool.query("UPDATE rooms SET status = 'finished' WHERE id = $1", [req.params.roomId]);
  return { ok: true };
});

/** Internal: rooms a user is currently in, for the BFF home screen. */
app.get<{ Params: { userId: string } }>('/internal/users/:userId/rooms', async (req) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.code, r.status, r.game_id
       FROM rooms r
       JOIN room_seats s ON s.room_id = r.id
      WHERE s.user_id = $1 AND r.status <> 'finished'
      ORDER BY r.created_at DESC LIMIT 20`,
    [req.params.userId],
  );
  return {
    rooms: rows.map((r: { id: string; code: string; status: string; game_id: string | null }) => ({
      roomId: r.id,
      code: r.code,
      status: r.status,
      gameId: r.game_id,
    })),
  };
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: err.message });
});

const port = envInt('PORT', 4002);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}