# Running it locally

Everything below is free and runs on your laptop. Total first-run time: about
five minutes, most of it `npm install`.

## Prerequisites

- **Node 22 or newer** — `node -v`
- **Docker Desktop** (or Docker Engine + Compose) running

That's it. No cloud account, no payment method.

---

## Step 1 — install and build

```bash
npm install
npm run build
```

`npm run build` compiles the packages in dependency order (`shared` → `kit` →
`engine` → `events`) and then the five services. Expect no output on success.

## Step 2 — verify the rules engine

```bash
npm test
```

**Expect: 23 passing tests.** These need no database and no network — the
engine is a pure function, which is exactly why it can be tested this way.

## Step 3 — start Postgres, Redis and NATS

```bash
npm run infra:up
```

Wait around ten seconds, then confirm all three are healthy:

```bash
docker compose ps
```

All three should show `healthy`. The database schema is applied automatically
the first time the volume is created — you do not need to run it by hand.

> Starting fresh later? `npm run infra:down` deletes the volumes, and the next
> `infra:up` recreates the schema.

## Step 4 — create your environment file

```bash
cp .env.example .env
```

For local use the defaults work as-is. Before deploying anywhere public,
replace `JWT_SECRET`:

```bash
openssl rand -hex 32
```

## Step 5 — start the services

```bash
npm run dev
```

You should see five prefixed log streams and this summary:

```
  identity  http://localhost:4001
  room      http://localhost:4002
  game      http://localhost:4003
  gateway   http://localhost:4004   <- open this in 4 tabs
  bff       http://localhost:4005/graphql
```

Confirm every service is ready:

```bash
for p in 4001 4002 4003 4004 4005; do curl -s localhost:$p/readyz; echo; done
```

The game service reports each dependency separately:

```json
{"status":"ready","checks":{"redis":true,"postgres":true,"eventBus":true}}
```

If `eventBus` is `false`, NATS is not up yet — the service retries with
backoff and will go ready on its own within a few seconds.

## Step 6 — prove it works without touching a browser

In a second terminal:

```bash
npm run smoke
```

This signs in four guests, creates a room, joins, starts a game, and plays it
to completion through the real HTTP and WebSocket APIs. **Expect 28 checks and
`ALL CHECKS PASSED`**, including a full game (usually 600–800 commands) and
every dice roll re-derived from the revealed seed.

## Step 7 — play it in four tabs

1. Open **http://localhost:4004** in four browser tabs.
2. In each tab, type a name and click **Sign in as guest**.
3. In tab 1, click **Create room** — a six-character code appears.
4. In tabs 2–4, paste that code and click **Join**.
5. Back in tab 1, click **Start game**.

Each tab now shows the board. On your turn, click **Roll dice**, then click one
of your tokens to move it. Every tab updates within about 100ms.

---

## Things worth trying

**Reconnect and resume.** Refresh a tab mid-game. Sign in again is not needed —
the session cookie persists, and rejoining the room replays the current
snapshot. The board is immediately correct.

**Turn timeout.** Leave a tab idle on its turn for 30 seconds. The turn is
auto-played, and the log shows why. One disconnected player can never stall the
table.

**Kill a service.** Stop the game service (Ctrl-C the process, or
`docker compose stop` a dependency) and watch `/readyz` flip to 503. Restart it
— because game state lives in Redis, not process memory, the in-progress game
resumes exactly where it was. **This is the fault-isolation claim, demonstrated.**

**Verify the dice yourself.** After a game ends:

```bash
curl localhost:4003/games/<gameId>/fairness
```

The revealed seed lets you recompute every roll. The smoke test does exactly
this for all ~435 rolls of a full game.

**Explore the GraphQL layer.** Open http://localhost:4005/graphql and run:

```graphql
{ leaderboard(limit: 5) { user { displayName } wins played } }
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `EADDRINUSE` | A previous run is still going: `pkill -f "node services"` |
| `eventBus: false` persists | NATS container unhealthy: `docker compose logs nats` |
| `relation "users" does not exist` | Schema never applied. `npm run infra:down && npm run infra:up` |
| Socket connects then drops | `WEB_ORIGIN` must match the URL in your address bar |
| Blank board after Start | Check the browser console — usually a stale tab from before the game started; refresh it |

## Stopping

```bash
# Ctrl-C the npm run dev terminal, then:
npm run infra:down     # add nothing to keep data, this removes volumes
```
