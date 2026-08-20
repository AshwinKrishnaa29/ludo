// web/src/screens/Game.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PlayerColour } from '@ludo/shared';
import { Board } from '@/components/Board';
import { DiceTray } from '@/components/DiceTray';
import { PlayerSeat } from '@/components/PlayerSeat';
import { Flash, type FlashMessage } from '@/components/Flash';
import { Chat } from '@/components/Chat';
import { PausedOverlay } from '@/components/PausedOverlay';
import { EndScreen } from '@/components/EndScreen';
import { useGame } from '@/store/game';
import { useSession } from '@/store/session';
import { useGameSounds } from '@/hooks/useGameSounds';

interface Props {
  onLeave: () => void;
}

function useIsWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function Game({ onLeave }: Props) {
  const {
    state, legal, lastEvents, lastRoll, connected, rejection,
    unread, stats, roll, move, abandon, leaveGame, setSelf,
  } = useGame();
  const { userId } = useSession();
  const wide = useIsWide();
  const [now, setNow] = useState(Date.now());
  const [rolling, setRolling] = useState(false);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const flashSeq = useRef(0);
  const { playDice, playMove, playFlash } = useGameSounds();

  useEffect(() => { setSelf(userId); }, [userId, setSelf]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (lastEvents.some((e) => e.type === 'dice_rolled')) {
      setRolling(true);
      const t = setTimeout(() => setRolling(false), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [lastEvents]);

  useEffect(() => {
    const name = (uid: string) =>
      state?.players.find((p) => p.userId === uid)?.displayName ?? 'Someone';
    let msg: FlashMessage | null = null;
    for (const ev of lastEvents) {
      if (ev.type === 'token_captured')
        msg = { id: ++flashSeq.current, text: `${name(ev.byUserId)} knocked out ${name(ev.victimUserId)}`, tone: 'capture' };
      else if (ev.type === 'token_home')
        msg = { id: ++flashSeq.current, text: `${name(ev.userId)} got one home`, tone: 'home' };
      else if (ev.type === 'extra_turn')
        msg = { id: ++flashSeq.current, text: 'Another turn!', tone: 'bonus' };
      else if (ev.type === 'player_abandoned')
        msg = { id: ++flashSeq.current, text: `${name(ev.userId)} left the game`, tone: 'capture' };
      else if (ev.type === 'game_resumed')
        msg = { id: ++flashSeq.current, text: `${name(ev.userId)} is back`, tone: 'home' };
    }
    if (!msg) return;
    playFlash();
    setFlash(msg);
  }, [lastEvents, state, playFlash]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  const current = state?.players[state.turnIndex] ?? null;
  const myTurn = !!current && current.userId === userId;
  const secondsLeft = useMemo(() => {
    if (!state || state.phase === 'finished') return null;
    return Math.max(0, Math.round((state.turnDeadline - now) / 1000));
  }, [state, now]);

  if (!state) {
    return (
      <div className="grid min-h-full place-items-center">
        <motion.p
          animate={{ opacity: [0.35, 0.8, 0.35] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          className="display text-lg"
        >
          Setting the board
        </motion.p>
      </div>
    );
  }

  const activeColour: PlayerColour | null = current?.colour ?? null;
  const shownRoll = state.pendingRoll ?? lastRoll?.value ?? null;
  const prompt =
    state.phase === 'finished' ? 'Game over'
    : state.phase === 'paused'  ? 'Game on hold'
    : myTurn
      ? state.phase === 'awaiting_roll' ? 'Tap the centre to roll' : 'Choose a token'
      : `${current?.displayName ?? 'Someone'} is thinking`;

  const iLeft    = state.players.some((p) => p.userId === userId && p.abandoned);
  const left     = state.players.filter((_, i) => i % 2 === 0);
  const right    = state.players.filter((_, i) => i % 2 === 1);
  const activeId = state.players[state.turnIndex]?.userId;

  // Build seat props once so they aren't repeated four times below
  const seatProps = (p: (typeof state.players)[number]) => ({
    player: p,
    active: p.userId === activeId && state.phase !== 'finished',
    isMe: p.userId === userId,
    secondsLeft: p.userId === activeId ? secondsLeft : null,
    totalSeconds: 30,
    stats: stats[p.userId],
  });

  return (
    <div className="weave min-h-full px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-3 flex items-center justify-between sm:mb-5">
          <h1 className="display text-xl sm:text-2xl">Ludo</h1>
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="rounded-full border border-white/12 px-3.5 py-1.5 text-xs
                       transition hover:border-white/30 hover:bg-white/5"
          >
            Leave
          </button>
        </header>

        {/* Phone: 2-column seat rail above the board */}
        <div className="mb-3 grid grid-cols-2 gap-2 lg:hidden">
          {state.players.map((p) => (
            <PlayerSeat key={p.userId} {...seatProps(p)} />
          ))}
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,230px)_minmax(0,1fr)_minmax(0,280px)] lg:gap-6">

          {/* Desktop: left column */}
          <aside className="hidden flex-col gap-3 lg:flex">
            {left.map((p) => <PlayerSeat key={p.userId} {...seatProps(p)} />)}
            <div className="mt-2">
              {right.map((p) => (
                <div key={p.userId} className="mb-3">
                  <PlayerSeat {...seatProps(p)} />
                </div>
              ))}
            </div>
          </aside>

          {/* Board */}
          <main className="mx-auto w-full">
            <div className="relative mx-auto aspect-square w-full max-w-[min(88vw,72vh,600px)]">
              <Board state={state} legal={legal} meUserId={userId} onMove={move} onStep={playMove} />
              <Flash message={flash} />
              <AnimatePresence>
                {state.phase === 'paused' && (
                  <PausedOverlay
                    state={state}
                    secondsLeft={Math.max(0, Math.round((state.turnDeadline - now) / 1000))}
                    onDrop={abandon}
                  />
                )}
              </AnimatePresence>
              <DiceTray
                value={shownRoll}
                colour={activeColour}
                rolling={rolling}
                canRoll={myTurn && state.phase === 'awaiting_roll'}
                onRoll={() => { playDice(); roll(); }}
              />
            </div>

            <div className="mt-4 text-center">
              <AnimatePresence mode="wait">
                <motion.p
                  key={prompt}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className={`display text-lg sm:text-xl ${myTurn ? 'text-brass-soft' : 'opacity-60'}`}
                >
                  {prompt}
                </motion.p>
              </AnimatePresence>
              {rejection && (
                <p className="mt-1 text-xs text-[#e2574c]">
                  {rejection === 'illegal_move'
                    ? 'That token cannot move that far'
                    : rejection.replace(/_/g, ' ')}
                </p>
              )}
              {!connected && <p className="mt-1 text-xs text-brass-soft">Reconnecting</p>}
            </div>
          </main>

          {/* Desktop: chat docked on the right */}
          {wide && <div><Chat state={state} open onClose={() => setChatOpen(false)} /></div>}
        </div>
      </div>

      {/* Phone: chat behind a FAB */}
      {!wide && (
        <>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center rounded-full
                       bg-brass text-[#14172b] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]"
            aria-label="Open chat"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
              <path d="M12 3c5 0 9 3.1 9 7s-4 7-9 7a11 11 0 0 1-2.6-.3L5 19l1-3.4C4.1 14.3 3 12.3 3 10c0-3.9 4-7 9-7Z" />
            </svg>
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center
                               rounded-full bg-[#d1483f] px-1 text-[11px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <Chat state={state} open={chatOpen} onClose={() => setChatOpen(false)} />
        </>
      )}

      <AnimatePresence>
        {/* Leave confirmation dialog */}
        {confirmLeave && !iLeft && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-[#14172b]/85 p-6 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }}
              className="w-full max-w-xs rounded-3xl border border-white/12 bg-[#1c2140] p-6 text-center"
            >
              <h2 className="display text-xl">Leave the game?</h2>
              <p className="mt-2 text-sm leading-relaxed opacity-60">
                Your tokens come off the board and you cannot rejoin this match.
              </p>
              <button
                type="button"
                onClick={() => { leaveGame(); setConfirmLeave(false); }}
                className="mt-5 w-full rounded-2xl bg-[#d1483f] px-4 py-3 font-semibold text-white
                           transition hover:brightness-110"
              >
                Leave for good
              </button>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="mt-2 w-full rounded-2xl border border-white/12 px-4 py-3 text-sm
                           transition hover:bg-white/5"
              >
                Keep playing
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* Post-leave holding screen */}
        {iLeft && state.phase !== 'finished' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-[#14172b]/88 p-6 backdrop-blur-md"
          >
            <div className="w-full max-w-xs text-center">
              <h2 className="display text-2xl">You left this game</h2>
              <p className="mt-2 text-sm opacity-60">The others are playing on without you.</p>
              <button
                type="button"
                onClick={onLeave}
                className="mt-6 w-full rounded-2xl bg-brass px-4 py-3 font-semibold text-[#14172b]
                           transition hover:bg-brass-soft"
              >
                Back to the lobby
              </button>
            </div>
          </motion.div>
        )}

        {/* End screen — lives in its own file, just used here */}
        {state.phase === 'finished' && (
          <EndScreen state={state} stats={stats} userId={userId} onLeave={onLeave} />
        )}
      </AnimatePresence>
    </div>
  );
}
