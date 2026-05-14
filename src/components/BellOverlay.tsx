import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { BellRoll, PublicPlayer } from '@shared/types';
import { CHAMBERS } from '@shared/types';
import { Icon } from './primitives';
import { useCountdown } from '../lib/useCountdown';

type Phase = 'idle' | 'spinning' | 'result';

export function BellOverlay({
  player,
  isYou,
  result,
  deadline,
  onPull,
}: {
  player: PublicPlayer;
  isYou: boolean;
  /** Latest bell roll, or null if not pulled yet. */
  result: BellRoll | null;
  /** Server auto-pull deadline (ms since epoch), or null. */
  deadline: number | null;
  onPull: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const remainingMs = useCountdown(phase === 'idle' ? deadline : null);
  const remainingSec = Math.ceil(remainingMs / 1000);

  // When result arrives, run spin → result animation.
  useEffect(() => {
    if (!result) {
      setPhase('idle');
      return;
    }
    setPhase('spinning');
    const t = setTimeout(() => setPhase('result'), 1500);
    return () => clearTimeout(t);
  }, [result?.pullerSeat, result?.ring, result?.hotChamber]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="bell-stage"
    >
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
          padding: 24,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {isYou ? 'YOU OWE THE HOUSE' : `${player.name.toUpperCase()} OWES THE HOUSE`}
          </div>
          <div className="neon" style={{ fontSize: 'clamp(40px, 9vw, 56px)' }}>
            THE BELL
          </div>
        </div>

        <div className={`bell ${phase === 'spinning' ? 'shaking' : ''}`}>
          <div className="body">
            <div className="chambers">
              {Array.from({ length: CHAMBERS }, (_, i) => {
                const angle = (i / CHAMBERS) * Math.PI * 2 - Math.PI / 2;
                const isSpent = i < player.chamber;
                const isHotNow =
                  phase === 'result' && result && i === result.hotChamber;
                const r = 78;
                return (
                  <div
                    key={i}
                    className={`chamber ${isSpent ? 'spent' : ''} ${
                      isHotNow && result?.ring ? 'hot' : ''
                    }`}
                    style={{
                      transform: `translate(${Math.cos(angle) * r}px, ${
                        Math.sin(angle) * r
                      }px)`,
                    }}
                  />
                );
              })}
            </div>
            <motion.div
              className="clapper"
              animate={
                phase === 'spinning'
                  ? { rotate: 360 }
                  : { rotate: 0 }
              }
              transition={{
                duration: phase === 'spinning' ? 1.4 : 0.3,
                ease: 'easeOut',
              }}
            />
          </div>
        </div>

        <div style={{ minHeight: 96, display: 'grid', placeItems: 'center' }}>
          {phase === 'idle' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <button
                className="btn danger"
                style={{ fontSize: 16, padding: '16px 32px' }}
                onClick={onPull}
                disabled={!isYou}
              >
                {isYou ? (
                  <>
                    <Icon name="fire" /> Pull the Rope
                    {deadline ? ` · ${remainingSec}s` : ''}
                  </>
                ) : (
                  `${player.name} is pulling…${deadline ? ` (${remainingSec}s)` : ''}`
                )}
              </button>
              {isYou && deadline && remainingSec <= 3 && (
                <div
                  className="mono"
                  style={{
                    color: 'var(--ember)',
                    letterSpacing: '.22em',
                    textTransform: 'uppercase',
                    fontSize: 10,
                  }}
                >
                  House will pull for you
                </div>
              )}
            </div>
          )}
          {phase === 'spinning' && (
            <div
              className="mono"
              style={{
                color: 'var(--ink-2)',
                fontSize: 13,
                letterSpacing: '.3em',
                textTransform: 'uppercase',
              }}
            >
              The bell turns…
            </div>
          )}
          {phase === 'result' && result && (
            <div style={{ textAlign: 'center' }}>
              <div
                className="neon"
                style={{
                  fontSize: 'clamp(44px, 8vw, 64px)',
                  color: result.ring ? 'var(--ember)' : 'oklch(0.78 0.16 145)',
                  textShadow: `0 0 22px color-mix(in oklab, ${
                    result.ring ? 'var(--ember)' : 'oklch(0.78 0.16 145)'
                  } 70%, transparent)`,
                }}
              >
                {result.ring ? 'IT RINGS' : 'SILENCE'}
              </div>
              <div
                className="mono"
                style={{
                  color: 'var(--ink-2)',
                  fontSize: 11,
                  letterSpacing: '.3em',
                  textTransform: 'uppercase',
                  marginTop: 8,
                }}
              >
                {result.ring
                  ? result.eliminated
                    ? `${player.name} is out.`
                    : `${player.name} loses a life.`
                  : `${player.name} survives.`}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
