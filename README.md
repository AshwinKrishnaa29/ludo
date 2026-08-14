# Ludo — real-time multiplayer, built as microservices

Four-player Ludo playable in any browser, with server-authoritative rules,
provably-fair dice, and games that survive a pod being killed mid-match.

> **Stage 2 of 5 complete.** Five services run and a full game is playable in
> four browser tabs. React board, Kubernetes and Terraform follow.
>
> See **[RUNNING.md](RUNNING.md)** to run it locally in about five minutes.

---

## Why microservices here

A split is only worth defending when two parts of a system face genuinely
different forces. Three apply:

| Force | Where it shows up |
| --- | --- |
| **Fault isolation with real consequence** | Four players twenty minutes into a match must not lose the game because a pod restarted. Game state lives in Redis, never in process memory. |
| **Connection-bound vs request-bound scaling** | The realtime gateway scales on concurrent WebSockets (memory-bound). The game engine scales on moves (CPU-bound). Different HPA policies, different pods. |
| **Independent deploy cadence** | Matchmaking, engine and profile ship on their own schedules without coordinated releases. |

**What is honestly *not* claimed:** this is not a high-throughput system. Four
players make a move every few seconds. The architecture earns its keep on
availability and isolation, not on write volume.

**Deliberately not separate services:** chat (folded into the gateway), user
profiles, and static assets. Splitting those would add hops without adding
isolation.

---

## What exists

```
packages/
  shared/   @ludo/shared  — domain types, board geometry, commands, events
  engine/   @ludo/engine  — pure rules engine + provably-fair dice
  kit/      @ludo/kit     — config, JWT sessions, correlation ids
  events/   @ludo/events  — NATS envelope contract, publisher, subscriber
services/
  identity/  :4001  guest sessions, JWT issuance
  room/      :4002  room codes, seat allocation, game start
  game/      :4003  command application, Redis state, turn timers
  gateway/   :4004  Socket.io, auth, fan-out  (serves the test client)
  bff/       :4005  GraphQL aggregation over the other services
db/init.sql          — schema, one section per owning service
scripts/smoke-test.mjs — plays a full game through the real APIs
```

### Verified end to end

`npm run smoke` drives the live services with nothing mocked. Latest run:

```
28 checks — ALL CHECKS PASSED
  full game played            747 commands, 4 players ranked
  live fan-out                749 envelopes, no duplicates, versions increasing
  dice verified from seed     435 rolls re-derived and matched
  replayed command            applied exactly once
  out-of-turn / early move    rejected with not_your_turn / wrong_phase
```

### A bug worth keeping in the history

The first version of the event bus logged a warning and fell back to a no-op
publisher if NATS was not up at boot. In Kubernetes, pods start in arbitrary
order — so the game service would routinely come up "healthy", serve traffic,
and silently never emit an update. Players would watch a frozen board while
the engine happily processed moves.

The fix was two-part, and both halves matter: the bus now retries with capped
backoff instead of giving up, and `/readyz` reports the event bus as its own
check. **A readiness probe that does not cover every dependency is worse than
no probe at all**, because it makes a broken instance look correct.

### Design decisions worth knowing

**Colour-relative `progress`.** A token's position is the number of steps it
has taken (`0..51` ring, `52..56` home column, `57` home), not an absolute
square. Absolute squares are derived only when checking captures. This removes
almost all modular arithmetic from the rules and made the whole engine
testable.

**The engine is a pure function.** `applyCommand(state, command, deps)` returns
new state plus events and touches nothing else — no clock, no database, no
randomness. `now` and the dice roller are injected. That is why 23 tests can
cover every rule without a running service.

**Idempotency is built into the domain, not bolted on.** Every command carries
a client-generated `commandId`, and replaying one is a guaranteed no-op. A
player whose phone drops mid-move and retries cannot roll twice. The last 64
ids are retained, which bounds state size.

**Provably-fair dice.** The server commits to `sha256(serverSeed)` before the
first roll; each roll is derived from `serverSeed:nonce` by rejection sampling
(uniform, not `% 6`); the seed is revealed at game end. Any player can then
recompute every roll and prove the server never re-rolled after seeing the
board. Clients never generate dice values.

### Rules implemented

Six to leave the yard · exact roll required to reach the centre · captures send
a token back to the yard · eight safe squares (four entries, four stars) ·
extra turn for a six, a capture, or sending a token home · three consecutive
sixes forfeits the turn · home columns are private and capture-proof · finishing
ranks with the game ending when one player remains · auto-play on turn timeout
so a disconnected player can never stall the table.

---

## Verify it yourself

```bash
npm install && npm run build
npm test                # 23 engine tests, no infrastructure needed
npm run infra:up        # Postgres + Redis + NATS
cp .env.example .env
npm run dev             # five services
npm run smoke           # 28 checks, plays a full game
```

Then open http://localhost:4004 in four tabs. Full walkthrough in
**[RUNNING.md](RUNNING.md)**.

---

## Stack, and why each piece is here

| Layer | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript (strict) | Shared domain types across every service — the contract is compiler-enforced. |
| Rules | Pure functions, zero deps | Testable without infrastructure; trivially portable into any service. |
| Live state | Redis with AOF | Must survive pod restarts. This is what makes the chaos test pass. |
| Durable state | PostgreSQL | Users, match history and ratings are relational. |
| Events | NATS JetStream | Durable at-least-once streams in a 15 MB binary. Kafka would need more RAM than the whole free tier. |
| Realtime | Socket.io + Redis adapter | Reconnect, rooms and cross-pod fan-out without rebuilding all three. |
| HTTP | Fastify | Schema validation at the edge of each service, so the contract is enforced rather than documented. |
| Lobby API | GraphQL (Apollo + DataLoader) | The home screen aggregates four services in one round trip; DataLoader batches user lookups that would otherwise be N+1. |

**Deliberately excluded:** MongoDB (match history is relational — adding a
second database for one document type would be cost without benefit) and
Redux Toolkit on the client (the server pushes authoritative state over a
socket; there is no HTTP cache to manage).

---

## Roadmap

- [x] **Stage 1** — domain contract, rules engine, provable dice, local infra
- [x] **Stage 2** — five services, live play in four tabs, smoke test
- [ ] **Stage 3** — React board, token animation, reconnect and resume
- [ ] **Stage 4** — Kustomize manifests, k3d, Argo CD, OpenTelemetry + Grafana
- [ ] **Stage 5** — Terraform (EKS), multi-arch CI, k6 load test, chaos test
