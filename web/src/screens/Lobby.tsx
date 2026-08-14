import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYER_COLOURS, type PlayerColour } from '@ludo/shared';
import { gql, post } from '@/lib/api';
import { useSession } from '@/store/session';
import { useRoom } from '@/store/room';
import { DEEP, FILL } from '@/lib/colours';

interface Seat {
  userId: string;
  displayName: string;
  seatIndex: number;
  colour: PlayerColour;
}

export interface RoomView {
  roomId: string;
  code: string;
  status: string;
  gameId: string | null;
  seats: Seat[];
}

const ROOM_QUERY = `
  query Room($code: String!) {
    room(code: $code) {
      roomId
      code
      status
      gameId
      seats { userId displayName seatIndex colour }
    }
  }
`;

const COLOUR_NAME: Record<PlayerColour, string> = {
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
};

interface Props {
  onGameReady: (gameId: string) => void;
}

export function Lobby({ onGameReady }: Props) {
  const { token, userId, displayName, signOut } = useSession();
  const { code, setRoom, leave } = useRoom();
  const [input, setInput] = useState('');
  const [room, setRoomView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const poll = useCallback(async () => {
    if (!code) return;
    try {
      const data = await gql<{ room: RoomView | null }>(ROOM_QUERY, { code }, token);
      // A stored room code used to trap you here: the waiting screen showed
      // whatever room you last joined, with no way back to the join box. A
      // room that has ended, or vanished, now releases you.
      if (!data.room || data.room.status === 'finished') {
        leave();
        setRoomView(null);
        return;
      }
      setRoomView(data.room);
      if (data.room.gameId) onGameReady(data.room.gameId);
    } catch {
      /* keep polling */
    }
  }, [code, token, onGameReady, leave]);

  useEffect(() => {
    if (!code) return undefined;
    void poll();
    const id = setInterval(() => void poll(), 1500);
    return () => clearInterval(id);
  }, [code, poll]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.replace(/_/g, ' '));
    } finally {
      setBusy(false);
    }
  }

  const join = () =>
    run(async () => {
      const c = input.trim().toUpperCase();
      const d = await post<{ seatIndex: number }>(`/rooms/${c}/join`, undefined, token);
      setRoomView(null);
      setRoom(c, d.seatIndex);
    });

  const mySeat = room?.seats.find((s) => s.userId === userId) ?? null;
  const taken = new Set(room?.seats.map((s) => s.colour) ?? []);
  const isHost = room?.seats.find((s) => s.seatIndex === 0)?.userId === userId;
  const seated = room?.seats.length ?? 0;

  return (
    <div className="weave min-h-full px-5 py-5 sm:px-8">
      <header className="mx-auto flex max-w-lg items-center justify-between">
        <h1 className="display text-xl">Ludo</h1>
        <button
          type="button"
          onClick={() => {
            leave();
            signOut();
          }}
          className="text-xs opacity-50 transition hover:opacity-100"
        >
          {displayName} &middot; sign out
        </button>
      </header>

      <div className="mx-auto mt-10 max-w-[22rem]">
        <AnimatePresence mode="wait">
          {!code ? (
            <motion.div
              key="choose"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const data = await post<{ code: string }>('/rooms', { maxPlayers: 4 }, token);
                    setRoomView(null);
                    setRoom(data.code, 0);
                  })
                }
                disabled={busy}
                className="w-full rounded-2xl bg-brass px-4 py-4 font-semibold text-[#14172b]
                           transition hover:bg-brass-soft disabled:opacity-45"
              >
                Start a new game
              </button>

              <div className="my-7 flex items-center gap-4 text-[11px] uppercase tracking-[0.25em] opacity-35">
                <span className="h-px flex-1 bg-white/15" />
                joining a friend
                <span className="h-px flex-1 bg-white/15" />
              </div>

              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && input.trim() && void join()}
                  placeholder="ROOM CODE"
                  maxLength={8}
                  aria-label="Room code"
                  className="mono min-w-0 flex-1 rounded-2xl border border-white/12 bg-white/[0.04]
                             px-4 py-3.5 tracking-[0.28em] outline-none transition
                             placeholder:tracking-[0.1em] placeholder:opacity-25
                             focus:border-brass/60 focus:bg-white/[0.07]"
                />
                <button
                  type="button"
                  onClick={() => void join()}
                  disabled={busy || !input.trim()}
                  className="rounded-2xl border border-white/15 px-5 font-medium transition
                             hover:border-brass/50 hover:bg-white/[0.06] disabled:opacity-35"
                >
                  Join
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="room"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="rounded-3xl border border-brass/25 bg-white/[0.04] px-6 py-7 text-center">
                <p className="text-[11px] uppercase tracking-[0.3em] text-brass">Room code</p>
                <p className="mono mt-2 text-[2.4rem] leading-none tracking-[0.18em]">{code}</p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border
                             border-white/12 px-3 py-1.5 text-xs opacity-70 transition
                             hover:border-brass/50 hover:bg-white/[0.06] hover:opacity-100"
                >
                  {copied ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none"
                         stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"
                         strokeLinejoin="round">
                      <path d="m4 12.5 5 5L20 6.5" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none"
                         stroke="currentColor" strokeWidth={1.9} strokeLinecap="round"
                         strokeLinejoin="round">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                  {copied ? 'Copied' : 'Copy code'}
                </button>
              </div>

              {/* Colour is your route around the board, not decoration, so no
                  two players can share one. Taken colours are shown as taken
                  rather than hidden, so you can see who has what. */}
              <div className="mt-5">
                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] opacity-45">
                  Your colour
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {PLAYER_COLOURS.map((c) => {
                    const owner = room?.seats.find((s) => s.colour === c);
                    const mine = owner?.userId === userId;
                    const free = !taken.has(c) || mine;
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!free || busy}
                        onClick={() =>
                          void run(async () => {
                            await post(`/rooms/${code}/colour`, { colour: c }, token);
                            await poll();
                          })
                        }
                        aria-label={`${COLOUR_NAME[c]}${free ? '' : ' - taken'}`}
                        className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3
                          transition ${
                            mine
                              ? 'border-brass bg-white/[0.09]'
                              : free
                                ? 'border-white/10 hover:border-white/30 hover:bg-white/[0.05]'
                                : 'border-white/5 opacity-30'
                          }`}
                      >
                        <span
                          className="h-7 w-7 rounded-full"
                          style={{
                            background: FILL[c],
                            boxShadow: `inset 0 -3px 0 ${DEEP[c]}`,
                          }}
                        />
                        <span className="text-[10px] opacity-60">
                          {mine ? 'You' : owner ? 'Taken' : COLOUR_NAME[c]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <ul className="mt-5 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => {
                  const seat = room?.seats.find((s) => s.seatIndex === i);
                  return (
                    <motion.li
                      key={i}
                      layout
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors
                        ${seat ? 'border-white/12 bg-white/[0.05]' : 'border-dashed border-white/10'}`}
                    >
                      <span
                        className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-white"
                        style={
                          seat
                            ? {
                                background: FILL[seat.colour],
                                boxShadow: `inset 0 -2px 0 ${DEEP[seat.colour]}`,
                              }
                            : { border: '1px dashed rgba(255,255,255,0.18)' }
                        }
                      >
                        {seat ? seat.displayName.slice(0, 1).toUpperCase() : ''}
                      </span>
                      <span className={seat ? 'text-[15px]' : 'text-[15px] opacity-30'}>
                        {seat ? seat.displayName : 'Open seat'}
                      </span>
                      {seat?.userId === userId && <span className="text-xs opacity-45">you</span>}
                      {i === 0 && (
                        <span className="ml-auto text-[10px] uppercase tracking-[0.2em] opacity-35">
                          host
                        </span>
                      )}
                    </motion.li>
                  );
                })}
              </ul>

              {isHost ? (
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await post(`/rooms/${code}/start`, undefined, token);
                    })
                  }
                  disabled={busy || seated < 2}
                  className="mt-5 w-full rounded-2xl bg-brass px-4 py-4 font-semibold text-[#14172b]
                             transition hover:bg-brass-soft disabled:opacity-35"
                >
                  {seated < 2 ? 'Waiting for one more player' : `Start with ${seated}`}
                </button>
              ) : (
                <p className="mt-5 text-center text-sm opacity-50">
                  Sit tight. The host starts the game.
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  leave();
                  setRoomView(null);
                }}
                className="mt-3 w-full rounded-2xl border border-white/12 py-2.5 text-xs
                           opacity-70 transition hover:border-white/30 hover:opacity-100"
              >
                Leave and start somewhere else
              </button>
              {mySeat && (
                <p className="mt-2 text-center text-[11px] opacity-35">
                  You are {COLOUR_NAME[mySeat.colour].toLowerCase()}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p className="mt-4 text-center text-sm text-[#e2574c]">{error}</p>}
      </div>
    </div>
  );
}