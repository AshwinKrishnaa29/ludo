import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import DataLoader from 'dataloader';
import pg from 'pg';
import { env, envInt, extractToken, makeVerifier } from '@ludo/kit';

const verify = makeVerifier(env('JWT_SECRET'));
const pool = new pg.Pool({ connectionString: env('DATABASE_URL') });
const IDENTITY_URL = env('IDENTITY_URL', 'http://localhost:4001');
const ROOM_URL = env('ROOM_URL', 'http://localhost:4002');
const GAME_URL = env('GAME_URL', 'http://localhost:4003');

const typeDefs = `#graphql
  type User {
    id: ID!
    displayName: String!
  }

  type Seat {
    userId: ID!
    displayName: String!
    seatIndex: Int!
    colour: String!
  }

  type Room {
    roomId: ID!
    code: String!
    status: String!
    gameId: ID
    seats: [Seat!]!
  }

  type MatchPlayer {
    user: User!
    colour: String!
    rank: Int!
  }

  type Match {
    id: ID!
    finishedAt: String!
    totalMoves: Int!
    players: [MatchPlayer!]!
  }

  type LeaderboardRow {
    user: User!
    wins: Int!
    played: Int!
  }

  """
  The whole home screen in one round trip. Assembling this from four services
  is the reason a GraphQL layer earns its place here — over REST the client
  would make four calls and stitch them itself.
  """
  type Home {
    me: User!
    activeRooms: [Room!]!
    recentMatches: [Match!]!
    leaderboard: [LeaderboardRow!]!
  }

  type Query {
    home: Home!
    room(code: String!): Room
    leaderboard(limit: Int = 10): [LeaderboardRow!]!
  }
`;

interface Ctx {
  userId: string | null;
  displayName: string | null;
  userLoader: DataLoader<string, { id: string; displayName: string }>;
}

/**
 * Batches every user lookup in a single GraphQL request into one call to the
 * identity service. Without this a ten-row leaderboard would make ten HTTP
 * hops — the classic N+1 that kills naive service-backed GraphQL.
 */
function makeUserLoader() {
  return new DataLoader<string, { id: string; displayName: string }>(async (ids) => {
    const res = await fetch(`${IDENTITY_URL}/internal/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [...ids] }),
      signal: AbortSignal.timeout(3_000),
    });
    const { users } = (await res.json()) as { users: { id: string; displayName: string }[] };
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids.map((id) => byId.get(id) ?? { id, displayName: 'Unknown' });
  });
}

async function fetchRoom(code: string) {
  const res = await fetch(`${ROOM_URL}/rooms/${code}`, { signal: AbortSignal.timeout(3_000) });
  if (!res.ok) return null;
  return res.json();
}

async function recentMatches(userId: string) {
  const { rows } = await pool.query(
    `SELECT m.id, m.finished_at, m.total_moves
       FROM matches m
       JOIN match_players p ON p.match_id = m.id
      WHERE p.user_id = $1
      ORDER BY m.finished_at DESC LIMIT 10`,
    [userId],
  );
  return rows;
}

async function leaderboardRows(limit: number) {
  const { rows } = await pool.query(
    `SELECT user_id,
            COUNT(*) FILTER (WHERE rank = 1) AS wins,
            COUNT(*) AS played
       FROM match_players
      GROUP BY user_id
      ORDER BY wins DESC, played ASC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

const resolvers = {
  Query: {
    async home(_p: unknown, _a: unknown, ctx: Ctx) {
      if (!ctx.userId) throw new Error('unauthorised');
      const [roomsRes, matches, board] = await Promise.all([
        fetch(`${ROOM_URL}/internal/users/${ctx.userId}/rooms`, {
          signal: AbortSignal.timeout(3_000),
        }).then(async (r) =>
          r.ok ? ((await r.json()) as { rooms: { code: string }[] }) : { rooms: [] },
        ),
        recentMatches(ctx.userId),
        leaderboardRows(10),
      ]);

      const activeRooms = await Promise.all(
        (roomsRes.rooms as { code: string }[]).map((r) => fetchRoom(r.code)),
      );

      return {
        me: { id: ctx.userId, displayName: ctx.displayName ?? 'Player' },
        activeRooms: activeRooms.filter(Boolean),
        recentMatches: matches,
        leaderboard: board,
      };
    },
    room: (_p: unknown, args: { code: string }) => fetchRoom(args.code),
    leaderboard: (_p: unknown, args: { limit: number }) => leaderboardRows(args.limit ?? 10),
  },

  Match: {
    id: (m: { id: string }) => m.id,
    finishedAt: (m: { finished_at: Date }) => m.finished_at.toISOString(),
    totalMoves: (m: { total_moves: number }) => m.total_moves,
    async players(m: { id: string }, _a: unknown, ctx: Ctx) {
      const { rows } = await pool.query(
        'SELECT user_id, colour, rank FROM match_players WHERE match_id = $1 ORDER BY rank',
        [m.id],
      );
      return rows.map((r: { user_id: string; colour: string; rank: number }) => ({
        userId: r.user_id,
        colour: r.colour,
        rank: r.rank,
      }));
    },
  },

  MatchPlayer: {
    user: (p: { userId: string }, _a: unknown, ctx: Ctx) => ctx.userLoader.load(p.userId),
  },

  LeaderboardRow: {
    user: (r: { user_id: string }, _a: unknown, ctx: Ctx) => ctx.userLoader.load(r.user_id),
    wins: (r: { wins: string }) => Number(r.wins),
    played: (r: { played: string }) => Number(r.played),
  },
};

const app = Fastify({ logger: { level: env('LOG_LEVEL', 'info') } });
await app.register(cookie);
await app.register(fastifyCors, { origin: env('WEB_ORIGIN', 'http://localhost:4000'), credentials: true });

app.get('/healthz', async () => ({ status: 'ok' }));
app.get('/readyz', async () => ({ status: 'ready' }));

const apollo = new ApolloServer<Ctx>({
  typeDefs,
  resolvers,
  plugins: [fastifyApolloDrainPlugin(app)],
});
await apollo.start();

await app.register(fastifyApollo(apollo), {
  context: async (req) => {
    const token = extractToken(req.headers as Record<string, unknown>);
    let userId: string | null = null;
    let displayName: string | null = null;
    if (token) {
      try {
        const claims = verify(token);
        userId = claims.sub;
        displayName = claims.name;
      } catch {
        // An expired token is treated as anonymous rather than an error, so
        // public queries such as the leaderboard still resolve.
      }
    }
    return { userId, displayName, userLoader: makeUserLoader() };
  },
});

const port = envInt('PORT', 4005);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await apollo.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
