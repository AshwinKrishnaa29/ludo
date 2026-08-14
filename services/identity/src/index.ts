import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import {
  COOKIE_OPTIONS,
  SESSION_COOKIE,
  env,
  envInt,
  extractToken,
  makeSigner,
  makeVerifier,
} from '@ludo/kit';

const pool = new pg.Pool({ connectionString: env('DATABASE_URL') });
const sign = makeSigner(env('JWT_SECRET'));
const verify = makeVerifier(env('JWT_SECRET'));

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

/**
 * Guest sign-in. Deliberately frictionless: a player should be able to open an
 * invite link and be in the room in one tap. Real OAuth slots in beside this
 * without changing anything downstream, because every other service only ever
 * sees the JWT.
 */
app.post<{ Body: { displayName?: string } }>(
  '/sessions/guest',
  {
    schema: {
      body: {
        type: 'object',
        properties: { displayName: { type: 'string', minLength: 1, maxLength: 24 } },
      },
    },
  },
  async (req, reply) => {
    const id = crypto.randomUUID();
    const name = req.body?.displayName?.trim() || `Player-${id.slice(0, 4)}`;

    await pool.query(
      'INSERT INTO users (id, display_name, is_guest) VALUES ($1, $2, TRUE)',
      [id, name],
    );

    const token = sign({ sub: id, name, guest: true });
    return reply
      .setCookie(SESSION_COOKIE, token, COOKIE_OPTIONS)
      .send({ userId: id, displayName: name, token });
  },
);

app.get('/sessions/me', async (req, reply) => {
  const token = extractToken(req.headers as Record<string, unknown>);
  if (!token) return reply.code(401).send({ error: 'no_session' });
  try {
    const claims = verify(token);
    return { userId: claims.sub, displayName: claims.name, guest: claims.guest };
  } catch {
    return reply.code(401).send({ error: 'invalid_session' });
  }
});

app.post('/sessions/logout', async (_req, reply) =>
  reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true }),
);

/** Internal: batch lookup used by the BFF's DataLoader. */
app.post<{ Body: { ids: string[] } }>('/internal/users', async (req) => {
  const ids = req.body?.ids ?? [];
  if (ids.length === 0) return { users: [] };
  const { rows } = await pool.query(
    'SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return {
    users: rows.map((r: { id: string; display_name: string }) => ({
      id: r.id,
      displayName: r.display_name,
    })),
  };
});

const port = envInt('PORT', 4001);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info('shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
