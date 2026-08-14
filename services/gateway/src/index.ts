import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyProxy from '@fastify/http-proxy';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { GameCommand } from '@ludo/shared';
import { env, envInt, extractToken, makeVerifier } from '@ludo/kit';
import { subscribeEvents, type GameEnvelope } from '@ludo/events';

const verify = makeVerifier(env('JWT_SECRET'));
const GAME_URL = env('GAME_URL', 'http://localhost:4003');
const IDENTITY_URL = env('IDENTITY_URL', 'http://localhost:4001');
const ROOM_URL = env('ROOM_URL', 'http://localhost:4002');
const WEB_ORIGIN = env('WEB_ORIGIN', 'http://localhost:4004');

const app = Fastify({ logger: { level: env('LOG_LEVEL', 'info') } });
await app.register(fastifyCors, { origin: WEB_ORIGIN, credentials: true });

// The built client is served from here so the whole stack is reachable on one
// port. In development Vite serves it instead and proxies back to this port.
await app.register(fastifyStatic, {
  root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'),
});

// Auth, room and game calls are proxied rather than called directly by the
// browser. One origin means no CORS preflight and no cross-site cookies - and
// it is how the ingress will route these paths in production, so local
// development matches the deployed shape.
await app.register(fastifyProxy, {
  upstream: IDENTITY_URL,
  prefix: '/sessions',
  rewritePrefix: '/sessions',
});

await app.register(fastifyProxy, {
  upstream: ROOM_URL,
  prefix: '/rooms',
  rewritePrefix: '/rooms',
});

await app.register(fastifyProxy, {
  upstream: GAME_URL,
  prefix: '/games',
  rewritePrefix: '/games',
});

app.get('/healthz', async () => ({ status: 'ok' }));
/**
 * A gateway that cannot receive events would accept sockets and then show a
 * frozen board, so the event subscription is part of readiness.
 */
app.get('/readyz', async (_req, reply) => {
  const checks = { eventBus: events.isConnected() };
  return checks.eventBus
    ? { status: 'ready', checks }
    : reply.code(503).send({ status: 'not_ready', checks });
});

const io = new SocketServer(app.server, {
  cors: { origin: WEB_ORIGIN, credentials: true },
  // Long-lived connections must survive a brief network blip without the
  // player losing their seat.
  pingInterval: 20_000,
  pingTimeout: 25_000,
});

// The Redis adapter is what lets several gateway replicas share socket rooms.
// Without it, two players on different pods would never see each other.
const pubClient = new Redis(env('REDIS_URL', 'redis://localhost:6379'));
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

io.use((socket, next) => {
  const token =
    (socket.handshake.auth?.['token'] as string | undefined) ??
    extractToken(socket.handshake.headers as Record<string, unknown>);
  if (!token) return next(new Error('unauthorised'));
  try {
    const claims = verify(token);
    socket.data['userId'] = claims.sub;
    socket.data['displayName'] = claims.name;
    next();
  } catch {
    next(new Error('invalid_token'));
  }
});

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------

/**
 * The gateway holds no game state. It authenticates, forwards commands to the
 * game service, and fans out whatever comes back on the event stream. That is
 * what lets it scale on connections while the engine scales on moves.
 */
io.on('connection', (socket) => {
  const userId = socket.data['userId'] as string;
  app.log.info({ userId, socketId: socket.id }, 'socket connected');

  socket.on('join_game', async (gameId: string, ack?: (payload: unknown) => void) => {
    if (typeof gameId !== 'string' || gameId.length === 0) return;
    await socket.join(gameId);

    // Replay current state so a reconnecting player is immediately correct.
    try {
      const res = await fetch(`${GAME_URL}/games/${gameId}`);
      if (res.ok) {
        const snapshot = await res.json();
        socket.emit('snapshot', snapshot);
        ack?.({ ok: true });
      } else {
        ack?.({ ok: false, error: 'game_not_found' });
      }
    } catch (err) {
      app.log.error({ err, gameId }, 'snapshot fetch failed');
      ack?.({ ok: false, error: 'unavailable' });
    }

    await forward(gameId, {
      type: 'set_connection',
      userId,
      connected: true,
      commandId: `conn-${socket.id}-up`,
      issuedAt: Date.now(),
    });
  });

  socket.on(
    'command',
    async (
      payload: { gameId: string; command: GameCommand },
      ack?: (result: unknown) => void,
    ) => {
      if (!payload?.gameId || !payload?.command) return;
      // A client may only ever act as itself. Never trust the body.
      const command = { ...payload.command, userId } as GameCommand;
      const result = await forward(payload.gameId, command);
      ack?.(result);
    },
  );

  /**
   * Table talk. Messages are relayed and never stored: nothing outlives the
   * game, so there is no history to leak and nothing to moderate afterwards.
   */
  const chatTimes: number[] = [];
  socket.on('chat', (payload: { gameId: string; text: string }) => {
    if (!payload?.gameId || typeof payload.text !== 'string') return;
    const text = payload.text.trim().slice(0, 200);
    if (!text) return;
    // Without this check anyone could broadcast into a game they are not in,
    // just by knowing its id.
    if (!socket.rooms.has(payload.gameId)) return;

    // Five messages per ten seconds is conversational; more is flooding.
    const now = Date.now();
    while (chatTimes.length > 0 && now - (chatTimes[0] as number) > 10_000) chatTimes.shift();
    if (chatTimes.length >= 5) return;
    chatTimes.push(now);

    io.to(payload.gameId).emit('chat', {
      id: crypto.randomUUID(),
      userId,
      displayName: socket.data['displayName'] as string,
      text,
      at: now,
    });
  });

  socket.on('disconnect', async () => {
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      await forward(room, {
        type: 'set_connection',
        userId,
        connected: false,
        commandId: `conn-${socket.id}-down`,
        issuedAt: Date.now(),
      });
    }
    app.log.info({ userId, socketId: socket.id }, 'socket disconnected');
  });
});

async function forward(
  gameId: string,
  command: GameCommand,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${GAME_URL}/games/${gameId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `http_${res.status}` };
  } catch (err) {
    app.log.error({ err, gameId }, 'command forward failed');
    return { ok: false, error: 'game_service_unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Event fan-out
// ---------------------------------------------------------------------------

/**
 * JetStream delivers at least once, so the same envelope can arrive twice.
 * Tracking the highest version already broadcast per game makes fan-out
 * idempotent - players never see a duplicated dice roll.
 */
const lastBroadcast = new Map<string, number>();

const events = subscribeEvents(
  env('NATS_URL', 'nats://localhost:4222'),
  'gateway',
  app.log,
  (envelope: GameEnvelope) => {
    const seen = lastBroadcast.get(envelope.gameId) ?? -1;
    if (envelope.version <= seen) return;
    lastBroadcast.set(envelope.gameId, envelope.version);
    io.to(envelope.gameId).emit('game_update', envelope);
  },
);

const port = envInt('PORT', 4004);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    // Drain: stop accepting new sockets, let in-flight commands finish.
    io.close();
    await events.close();
    await app.close();
    pubClient.disconnect();
    subClient.disconnect();
    process.exit(0);
  });
}