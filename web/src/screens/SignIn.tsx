import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSession } from '@/store/session';
import { FILL } from '@/lib/colours';

const COLOURS = ['red', 'green', 'yellow', 'blue'] as const;

export function SignIn() {
  const [name, setName] = useState('');
  const { signIn, busy, error } = useSession();

  return (
    <div className="weave grid min-h-full place-items-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        className="w-full max-w-[22rem]"
      >
        {/* Four tokens settling into their yards - the game in one gesture. */}
        <div className="mx-auto mb-7 grid h-24 w-24 grid-cols-2 gap-2">
          {COLOURS.map((c, i) => (
            <motion.span
              key={c}
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.15 + i * 0.09, type: 'spring', stiffness: 300, damping: 18 }}
              className="rounded-2xl"
              style={{ background: FILL[c], boxShadow: `inset 0 -4px 0 rgba(0,0,0,0.22)` }}
            />
          ))}
        </div>

        <h1 className="display text-center text-[2.6rem] leading-none">Ludo</h1>
        <p className="mt-2.5 text-center text-sm leading-relaxed opacity-55">
          Four tokens, one board, and a great deal of luck.
          <br />
          Play with up to three friends.
        </p>

        <div className="mt-8">
          <label htmlFor="name" className="mb-2 block text-[11px] uppercase tracking-[0.22em] opacity-45">
            What should we call you
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void signIn(name)}
            placeholder="Player"
            maxLength={20}
            className="w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3.5
                       text-[15px] outline-none transition placeholder:opacity-30
                       focus:border-brass/60 focus:bg-white/[0.07]"
          />
          <button
            type="button"
            onClick={() => void signIn(name)}
            disabled={busy}
            className="mt-3 w-full rounded-2xl bg-brass px-4 py-3.5 font-semibold text-[#14172b]
                       transition hover:bg-brass-soft disabled:opacity-45"
          >
            {busy ? 'Just a moment' : 'Start playing'}
          </button>
          {error && <p className="mt-3 text-center text-sm text-[#e2574c]">{error}</p>}
        </div>
      </motion.div>
    </div>
  );
}