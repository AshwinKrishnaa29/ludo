/**
 * Stage 2 smoke test. Drives the real services over HTTP and a real Socket.io
 * connection: sign in four guests, create a room, join, start, then play until
 * someone wins. Nothing is mocked.
 */
import { io } from 'socket.io-client';

const IDENTITY = 'http://127.0.0.1:4001';
const ROOM = 'http://127.0.0.1:4002';
const GAME = 'http://127.0.0.1:4003';
const GATEWAY = 'http://127.0.0.1:4004';
const BFF = 'http://127.0.0.1:4005';

const uuid = () => crypto.randomUUID();
let failures = 0;
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ' — ' + detail : ''}`);
}

async function json(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

console.log('\n== 1. identity: four guest sign-ins ==');
const players = [];
for (const name of ['Asha', 'Bala', 'Chitra', 'Dev']) {
  const { status, body } = await json(`${IDENTITY}/sessions/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: name }),
  });
  check(`sign in ${name}`, status === 200 && !!body.token);
  players.push({ ...body, name });
}

const auth = (p) => ({ authorization: `Bearer ${p.token}` });

console.log('\n== 2. room: create, join, seat allocation ==');
const created = await json(`${ROOM}/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth(players[0]) },
  body: JSON.stringify({ maxPlayers: 4 }),
});
check('host creates room', created.status === 200 && created.body.code?.length === 6,
  `code=${created.body.code}`);
const code = created.body.code;

for (const p of players.slice(1)) {
  const r = await json(`${ROOM}/rooms/${code}/join`, { method: 'POST', headers: auth(p) });
  check(`${p.name} joins`, r.status === 200, `seat=${r.body.seatIndex}`);
}

const rejoin = await json(`${ROOM}/rooms/${code}/join`, {
  method: 'POST', headers: auth(players[1]),
});
check('rejoin is idempotent', rejoin.status === 200 && rejoin.body.rejoined === true);

const roomView = await json(`${ROOM}/rooms/${code}`);
check('four distinct seats', new Set(roomView.body.seats.map((s) => s.seatIndex)).size === 4);

console.log('\n== 3. authorisation ==');
const notHost = await json(`${ROOM}/rooms/${code}/start`, {
  method: 'POST', headers: auth(players[2]),
});
check('non-host cannot start', notHost.status === 403, notHost.body.error);

console.log('\n== 4. game start ==');
const started = await json(`${ROOM}/rooms/${code}/start`, {
  method: 'POST', headers: auth(players[0]),
});
check('host starts game', started.status === 200 && !!started.body.gameId);
const gameId = started.body.gameId;

const restart = await json(`${ROOM}/rooms/${code}/start`, {
  method: 'POST', headers: auth(players[0]),
});
check('restart returns same game', restart.body.gameId === gameId);

console.log('\n== 5. websocket: connect and receive live events ==');
const received = [];
const sock = io(GATEWAY, { auth: { token: players[0].token }, transports: ['websocket'] });
await new Promise((resolve, reject) => {
  sock.on('connect', resolve);
  sock.on('connect_error', reject);
  setTimeout(() => reject(new Error('socket timeout')), 8000);
});
check('socket authenticated', sock.connected);

const snapshot = await new Promise((resolve) => {
  sock.on('snapshot', resolve);
  sock.emit('join_game', gameId);
});
check('snapshot on join', snapshot.state.gameId === gameId,
  `${snapshot.state.players.length} players`);
sock.on('game_update', (env) => received.push(env));

const rejected = io(GATEWAY, { auth: { token: 'garbage' }, transports: ['websocket'] });
const rejectErr = await new Promise((resolve) => {
  rejected.on('connect_error', (e) => resolve(e.message));
  setTimeout(() => resolve('no error'), 4000);
});
check('bad token refused', rejectErr !== 'no error', rejectErr);
rejected.close();

console.log('\n== 6. command validation ==');
const wrongTurn = await json(`${GAME}/games/${gameId}/commands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'roll_dice', userId: players[1].userId, commandId: uuid(), issuedAt: Date.now(),
  }),
});
check('out-of-turn roll rejected', wrongTurn.status === 409, wrongTurn.body.error);

const moveFirst = await json(`${GAME}/games/${gameId}/commands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'move_token', tokenId: 0, userId: players[0].userId,
    commandId: uuid(), issuedAt: Date.now(),
  }),
});
check('move before roll rejected', moveFirst.status === 409, moveFirst.body.error);

console.log('\n== 7. idempotency: replayed command ==');
const replayId = uuid();
const first = await json(`${GAME}/games/${gameId}/commands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'roll_dice', userId: players[0].userId, commandId: replayId, issuedAt: Date.now(),
  }),
});
const second = await json(`${GAME}/games/${gameId}/commands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'roll_dice', userId: players[0].userId, commandId: replayId, issuedAt: Date.now(),
  }),
});
check('replay applies once', first.body.applied === true && second.body.applied === false,
  `v${first.body.version} then applied=${second.body.applied}`);

console.log('\n== 8. play a full game ==');
const byId = new Map(players.map((p) => [p.userId, p]));
let turns = 0;
let finalState = null;

for (let i = 0; i < 4000; i += 1) {
  const { body } = await json(`${GAME}/games/${gameId}`);
  const state = body.state;
  if (state.phase === 'finished') { finalState = state; break; }

  const actor = state.players[state.turnIndex];
  const player = byId.get(actor.userId);
  const command = state.phase === 'awaiting_roll'
    ? { type: 'roll_dice' }
    : { type: 'move_token', tokenId: body.legalTokenIds[0] };

  const res = await json(`${GAME}/games/${gameId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...command, userId: player.userId, commandId: uuid(), issuedAt: Date.now(),
    }),
  });
  if (res.status !== 200) { console.log('   unexpected:', res.status, res.body); break; }
  turns += 1;
}

check('game reached a winner', finalState?.phase === 'finished', `${turns} commands`);
if (finalState) {
  const names = finalState.winnerOrder.map((id) => byId.get(id)?.name);
  console.log(`   final placings: ${names.join(' > ')}`);
  check('every player ranked', finalState.winnerOrder.length === 4);
  check('winner has all tokens home',
    finalState.players.find((p) => p.userId === finalState.winnerOrder[0])
      .tokens.every((t) => t.progress === 57));
}

console.log('\n== 9. live events reached the socket ==');
await new Promise((r) => setTimeout(r, 500));
check('gateway broadcast updates', received.length > 0, `${received.length} envelopes`);
const versions = received.map((e) => e.version);
check('no duplicate versions', new Set(versions).size === versions.length);
check('versions strictly increasing',
  versions.every((v, i) => i === 0 || v > versions[i - 1]));

console.log('\n== 10. provable fairness ==');
const fairness = await json(`${GAME}/games/${gameId}/fairness`);
check('seed revealed after game', fairness.status === 200 && !!fairness.body.serverSeed);

const rolls = received.flatMap((e) => e.events.filter((ev) => ev.type === 'dice_rolled'));
if (rolls.length > 0 && fairness.body.serverSeed) {
  const { createHash } = await import('node:crypto');
  const derive = (seed, nonce) => {
    let round = 0;
    for (;;) {
      const digest = createHash('sha256').update(`${seed}:${nonce}:${round}`).digest();
      for (const byte of digest) if (byte < 252) return (byte % 6) + 1;
      round += 1;
    }
  };
  const verified = rolls.every((r) => derive(fairness.body.serverSeed, r.rollProof.nonce) === r.value);
  check('every roll independently verifiable', verified, `${rolls.length} rolls checked`);
  const hash = createHash('sha256').update(fairness.body.serverSeed).digest('hex');
  check('seed matches published commitment', hash === rolls[0].rollProof.serverSeedHash);
}

console.log('\n== 11. match history persisted ==');
await new Promise((r) => setTimeout(r, 800));
const gql = await json(`${BFF}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth(players[0]) },
  body: JSON.stringify({
    query: `{ leaderboard(limit: 5) { user { displayName } wins played } }`,
  }),
});
check('graphql leaderboard resolves', gql.status === 200 && !gql.body.errors,
  JSON.stringify(gql.body.data?.leaderboard?.slice(0, 2) ?? gql.body.errors));

const home = await json(`${BFF}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth(players[0]) },
  body: JSON.stringify({
    query: `{ home { me { displayName } recentMatches { totalMoves players { user { displayName } rank } } } }`,
  }),
});
check('graphql home aggregates services',
  home.status === 200 && home.body.data?.home?.me?.displayName === 'Asha',
  `${home.body.data?.home?.recentMatches?.length ?? 0} matches`);

sock.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
