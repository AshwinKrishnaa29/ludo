// web/src/components/Chat.tsx

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { GameState } from '@ludo/shared';
import { useGame } from '@/store/game';
import { useSession } from '@/store/session';
import { FILL } from '@/lib/colours';
import { useGameSounds } from '@/hooks/useGameSounds';

const QUICK = ['GG', 'Nice one', 'Unlucky', 'Your turn', 'One sec'];
const EMOJI = ['\u{1F602}', '\u{1F62D}', '\u{1F525}', '\u{1F44F}', '\u{1F62E}', '\u{1F60E}'];

interface Props {
  state: GameState;
  open: boolean;
  onClose: () => void;
}

export function Chat({ state, open, onClose }: Props) {
  const { chat, say, unread } = useGame();
  const { userId } = useSession();
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const {playFlash } = useGameSounds();

  const prevLength = useRef(chat.length);

  useEffect(() => {
    if (chat.length > prevLength.current && !open) {
      playFlash();
    }
    prevLength.current = chat.length;
  }, [chat.length, open, playFlash]);

  // Clear unread count whenever the panel is open and new messages arrive
  useEffect(() => {
    if (open) useGame.setState({ unread: 0 });
  }, [open, chat.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);

  const colourOf = (uid: string) => {
    const p = state.players.find((x) => x.userId === uid);
    return p ? FILL[p.colour] : '#8a86a3';
  };

  function send(text: string) {
    say(text);
    setDraft('');
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-3xl
                     border-t border-brass/25 bg-[#1c2140] p-4 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)]
                     lg:static lg:max-h-none lg:h-[420px] lg:rounded-3xl lg:border lg:border-white/8
                     lg:bg-white/[0.03] lg:shadow-none"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.25em] opacity-45">Table talk</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-xs opacity-50 transition hover:opacity-100 lg:hidden"
            >
              Close
            </button>
          </div>

          <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto pr-1">
            {chat.length === 0 && (
              <p className="py-6 text-center text-xs opacity-35">Say something to the table.</p>
            )}
            {chat.map((m) => {
              const mine = m.userId === userId;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}>
                    {!mine && (
                      <p
                        className="mb-0.5 text-[11px] font-medium"
                        style={{ color: colourOf(m.userId) }}
                      >
                        {m.displayName}
                      </p>
                    )}
                    <p
                      className={`inline-block rounded-2xl px-3 py-1.5 text-sm
                        ${mine ? 'bg-brass text-[#14172b]' : 'bg-white/[0.08]'}`}
                    >
                      {m.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => send(e)}
                className="rounded-full bg-white/[0.06] px-2.5 py-1 text-base
                           transition hover:bg-white/[0.14]"
              >
                {e}
              </button>
            ))}
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs
                           transition hover:bg-white/[0.14]"
              >
                {q}
              </button>
            ))}
          </div>

          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && draft.trim() && send(draft)}
              placeholder="Message"
              maxLength={200}
              aria-label="Message"
              className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04]
                         px-4 py-2 text-sm outline-none transition placeholder:opacity-30
                         focus:border-brass/60"
            />
            <button
              type="button"
              onClick={() => draft.trim() && send(draft)}
              disabled={!draft.trim()}
              className="rounded-full bg-brass px-4 text-sm font-semibold text-[#14172b]
                         transition hover:bg-brass-soft disabled:opacity-35"
            >
              Send
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}