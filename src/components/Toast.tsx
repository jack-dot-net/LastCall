import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/game';

export function Toaster() {
  const toasts = useGameStore((s) => s.toasts);
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{
              borderColor:
                t.tone === 'warn'
                  ? 'color-mix(in oklab, var(--ember) 60%, var(--hairline-strong))'
                  : t.tone === 'success'
                  ? 'color-mix(in oklab, oklch(0.75 0.18 145) 60%, var(--hairline-strong))'
                  : 'var(--hairline-strong)',
            }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
