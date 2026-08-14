import Fastify from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import {
  CommandRejected,
  type GameCommand,
  type GameState,
  type PlayerColour,
} from '@ludo/shared';
import {
  ProvableDiceRoller,
  applyCommand,
  createGame,
  isPauseExpired,
  isTurnExpired,
  legalMoves,
} from '@ludo/engine';
import { env, envInt, correlationId } from '@ludo/kit';
import { GameStore, VersionConflict } from './store.js';
import { createBus, type EventBus } from '@ludo/events';

const redis = new Redis(env('REDIS_URL', 'redis://localhost:6379'));
const pool = new pg.Pool({ connectionString: env('DATABASE_URL') });
const store = new GameStore(redis);
const ROOM_URL = env('ROOM_URL', 'http://localhost:4002');

const app = Fastify({ logger: { level: env('LOG_LEVEL', 'info') } });
const bus: EventBus = createBus(env('NATS_URL', 'nats://localhost:4222'), 'game-service', app.log);

app.get('/healthz', async () => ({ status: 'ok' }));
/**
 * Readiness must cover EVERY dependency this service needs to do its job.
 * An earlier version checked only Redis and Postgres, so an instance with a
 * dead event bus reported healthy while players saw a frozen board. If the
 * bus is down we are not ready, and Kubernetes withholds traffic.
 */
app.get('/readyz', async (_req, reply) => {
  const checks = { redis: false, postgres: false, eventBus: bus.isConnected() };
  try {
    await redis.ping();
    checks.redis = true;
    await pool.query('SELECT 1');
    checks.postgres = true;
  } catch {
    // fall through to the 503 below
  }
  const ready = checks.redis && checks.postgres && checks.eventBus;
  return ready ? { status: 'ready', checks } : reply.code(503).send({ status: 'not_ready', checks });
});

// ---------------------------------------------------------------------------
// Command application
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 4;

/**
 * Read -> apply -> conditional write, retrying on version conflict.
 *
 * The engine is pure, so a conflict costs nothing but a re-read: we simply
 * replay the command against fresher state. Combined with `commandId`
 * deduplication inside the engine, a retry can never double-apply a move.
 */
async function submit(
  gameId: string,
  command: GameCommand,
  corrId: string,
): Promise<{ state: GameState; applied: boolean }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await store.load(gameId);
    if (!current) throw Object.assign(new Error('game_not_found'), { statusCode: 404 });

    const seed = await store.getSeed(gameId);
    // One nonce per attempt, allocated atomically. A retry burns a nonce,
    // which is harmless: each emitted roll carries the nonce that produced it.
    const nonce = await store.nextNonce(gameId);
    const dice = new ProvableDiceRoller(seed ?? undefined, nonce);

    const result = applyCommand(current, command, { dice, now: Date.now() });
    if (result.events.length === 0 && result.state === current) {
      return { state: current, applied: false };
    }

    try {
      await store.save(result.state, current.version);
    } catch (err) {
      if (err instanceof VersionConflict) {
        app.log.warn({ gameId, attempt, corrId }, 'version conflict, retrying');
        continue;
      }
      throw err;
    }

    await bus.publish({
      gameId,
      version: result.state.version,
      events: result.events,
      state: result.state,
      correlationId: corrId,
      emittedAt: Date.now(),
    });

    if (result.state.phase === 'finished') {
      await persistMatch(result.state).catch((err) =>
        app.log.error({ err, gameId }, 'failed to persist match history'),
      );
      // Release the room so returning players land in the lobby rather than
      // being pulled back into a game that is over.
      await fetch(`${ROOM_URL}/internal/rooms/${result.state.roomId}/finish`, {
        method: 'POST',
        signal: AbortSignal.timeout(3_000),
      }).catch((err) => app.log.warn({ err, gameId }, 'failed to close room'));
    }
    return { state: result.state, applied: true };
  }
  throw Object.assign(new Error('too_much_contention'), { statusCode: 503 });
}

/**
 * Match history is written after the game ends, on a best-effort basis. A
 * failure here must never break gameplay - the authoritative result already
 * reached every player over the socket.
 */
async function persistMatch(state: GameState): Promise<void> {
  const seed = (await store.getSeed(state.gameId)) ?? '';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO matches (id, room_id, winner_order, server_seed, total_moves, started_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO NOTHING`,
      [state.gameId, state.roomId, JSON.stringify(state.winnerOrder), seed, state.version],
    );
    for (const player of state.players) {
      const rank = player.finishedRank ?? state.winnerOrder.indexOf(player.userId) + 1;
      await client.query(
        `INSERT INTO match_players (match_id, user_id, colour, rank)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [state.gameId, player.userId, player.colour, Math.max(rank, 1)],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface SeatBody {
  userId: string;
  displayName: string;
  colour?: PlayerColour;
}

app.post<{ Body: { roomId: string; seats: SeatBody[] } }>(
  '/internal/games',
  async (req, reply) => {
    const { roomId, seats } = req.body;
    if (!Array.isArray(seats) || seats.length < 2) {
      return reply.code(400).send({ error: 'need_at_least_two_players' });
    }
    const gameId = crypto.randomUUID();
    const roller = new ProvableDiceRoller();
    await store.putSeed(gameId, roller.reveal());

    const state = createGame(gameId, roomId, seats, Date.now());
    await store.save(state, -1);
    await bus.publish({
      gameId,
      version: state.version,
      events: [],
      state,
      correlationId: correlationId(req.headers as Record<string, unknown>),
      emittedAt: Date.now(),
    });
    return { gameId, serverSeedHash: roller.serverSeedHash };
  },
);

app.get<{ Params: { gameId: string } }>('/games/:gameId', async (req, reply) => {
  const state = await store.load(req.params.gameId);
  if (!state) return reply.code(404).send({ error: 'game_not_found' });
  const moves =
    state.pendingRoll === null ? [] : legalMoves(state, state.pendingRoll).map((m) => m.tokenId);
  return { state, legalTokenIds: moves };
});

app.post<{ Params: { gameId: string }; Body: GameCommand }>(
  '/games/:gameId/commands',
  async (req, reply) => {
    const corrId = correlationId(req.headers as Record<string, unknown>);
    try {
      const { state, applied } = await submit(req.params.gameId, req.body, corrId);
      return { version: state.version, applied, phase: state.phase };
    } catch (err) {
      if (err instanceof CommandRejected) {
        return reply.code(409).send({ error: err.reason });
      }
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) app.log.error({ err, corrId }, 'command failed');
      return reply.code(status).send({ error: (err as Error).message });
    }
  },
);

/** Revealed once the game is over so players can verify every roll. */
app.get<{ Params: { gameId: string } }>('/games/:gameId/fairness', async (req, reply) => {
  const state = await store.load(req.params.gameId);
  const seed = await store.getSeed(req.params.gameId);
  if (!state || !seed) return reply.code(404).send({ error: 'game_not_found' });
  if (state.phase !== 'finished') {
    return reply.code(409).send({ error: 'seed_revealed_only_after_game_ends' });
  }
  return { serverSeed: seed };
});

// ---------------------------------------------------------------------------
// Turn timer
// ---------------------------------------------------------------------------

/**
 * Deadlines live in a Redis sorted set, not in `setTimeout`. A pod restart
 * therefore loses nothing: whichever replica ticks next picks up the expired
 * games.
 *
 * The same deadline field drives two different outcomes. While play is
 * running it means "this turn has gone on too long", and the missing player
 * is covered for. Once the game is paused it means "we have waited long
 * enough", and the missing player is dropped so the others can finish.
 */
const TICK_MS = envInt('TIMER_TICK_MS', 2_000);

async function tick(): Promise<void> {
  const now = Date.now();
  const due = await store.expiredGames(now);
  for (const gameId of due) {
    try {
      const state = await store.load(gameId);
      if (!state) continue;

      if (isPauseExpired(state, now)) {
        const missing = state.pausedFor;
        if (!missing) continue;
        await submit(
          gameId,
          {
            type: 'abandon_player',
            userId: 'system',
            targetUserId: missing,
            commandId: `abandon-${gameId}-${state.version}`,
            issuedAt: now,
          },
          `timer-${gameId}`,
        );
        app.log.info({ gameId, userId: missing }, 'dropped player after pause expired');
        continue;
      }

      if (!isTurnExpired(state, now)) continue;
      const current = state.players[state.turnIndex];
      if (!current) continue;
      await submit(
        gameId,
        {
          type: 'auto_play',
          userId: current.userId,
          commandId: `auto-${gameId}-${state.version}`,
          issuedAt: now,
        },
        `timer-${gameId}`,
      );
      app.log.info({ gameId, userId: current.userId }, 'auto-played expired turn');
    } catch (err) {
      app.log.error({ err, gameId }, 'timer action failed');
    }
  }
}

const timer = setInterval(() => {
  void tick();
}, TICK_MS);

const port = envInt('PORT', 4003);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await app.close();
    await bus.close();
    redis.disconnect();
    await pool.end();
    process.exit(0);
  });
}