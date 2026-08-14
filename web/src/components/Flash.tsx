import { AnimatePresence, motion } from 'framer-motion';

export interface FlashMessage {
  id: number;
  text: string;
  tone: 'capture' | 'bonus' | 'home';
}

const TONE: Record<FlashMessage['tone'], string> = {
  capture: 'from-[#d1483f] to-[#a3352e]',
  bonus: 'from-[#c9a227] to-[#9c7c17]',
  home: 'from-[#2f9159] to-[#226e42]',
};

/** Big moments announce themselves over the board, then get out of the way. */
export function Flash({ message }: { message: FlashMessage | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message.id}
          initial={{ opacity: 0, y: 14, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="pointer-events-none absolute left-1/2 top-[13%] z-20 -translate-x-1/2"
        >
          <span
            className={`block rounded-full bg-gradient-to-b ${TONE[message.tone]}
                        px-4 py-1.5 text-sm font-semibold text-white
                        shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]`}
          >
            {message.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}