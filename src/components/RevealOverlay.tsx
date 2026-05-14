import { motion } from 'framer-motion';
import type {
  Card as CardType,
  PublicPlayer,
  Rank,
} from '@shared/types';
import { GameCard } from './Card';

/**
 * Shown briefly after a challenge: the previously face-down cards flip up
 * and each is marked truth-or-lie against the table call. Non-matching,
 * non-wild cards get a red badge; matching/wild get green. After
 * REVEAL_PHASE_MS the server transitions to the bell phase.
 */
export function RevealOverlay({
  cards,
  claimedRank,
  claimedCount,
  lying,
  bluffer,
  challenger,
  loser,
}: {
  cards: CardType[];
  claimedRank: Rank;
  claimedCount: number;
  lying: boolean;
  bluffer: PublicPlayer | null;
  challenger: PublicPlayer | null;
  loser: PublicPlayer | null;
}) {
  return (
    <motion.div
      key="reveal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="bell-stage"
      style={{ zIndex: 48 }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
          padding: 24,
          maxWidth: '92vw',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {challenger?.name?.toUpperCase() ?? 'CHALLENGER'} CALLED LIAR ON{' '}
            {bluffer?.name?.toUpperCase() ?? 'BLUFFER'}
          </div>
          <div
            className="neon"
            style={{
              fontSize: 'clamp(40px, 9vw, 64px)',
              color: lying ? 'var(--ember)' : 'oklch(0.78 0.16 145)',
              textShadow: `0 0 24px color-mix(in oklab, ${
                lying ? 'var(--ember)' : 'oklch(0.78 0.16 145)'
              } 70%, transparent)`,
            }}
          >
            {lying ? 'LIAR' : 'HONEST'}
          </div>
          <div
            className="mono"
            style={{
              color: 'var(--ink-2)',
              letterSpacing: '.22em',
              textTransform: 'uppercase',
              fontSize: 11,
              marginTop: 6,
            }}
          >
            Claimed {claimedCount} × {claimedRank}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
            padding: '0 8px',
          }}
        >
          {cards.map((c, i) => {
            const matches = c.suit === claimedRank || c.suit === 'wild';
            const borderColor = matches
              ? 'oklch(0.78 0.16 145)'
              : 'var(--ember)';
            return (
              <motion.div
                key={c.id}
                initial={{ rotateY: 180, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                transition={{ delay: i * 0.18, duration: 0.5 }}
                style={{
                  position: 'relative',
                  filter: `drop-shadow(0 0 24px color-mix(in oklab, ${borderColor} 50%, transparent))`,
                }}
              >
                <GameCard suit={c.suit} />
                <div
                  className="mono"
                  style={{
                    position: 'absolute',
                    top: -10,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: matches
                      ? 'oklch(0.30 0.12 145)'
                      : 'oklch(0.30 0.14 25)',
                    color: matches
                      ? 'oklch(0.92 0.14 145)'
                      : 'oklch(0.92 0.14 25)',
                    border: `1px solid ${borderColor}`,
                    fontSize: 9,
                    letterSpacing: '.2em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {matches
                    ? c.suit === 'wild'
                      ? 'WILD'
                      : 'MATCH'
                    : 'NOT ' + claimedRank.toUpperCase()}
                </div>
              </motion.div>
            );
          })}
        </div>

        <div
          className="mono"
          style={{
            color: 'var(--ink-1)',
            fontSize: 13,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          {loser?.name ?? 'Someone'} pulls the bell
        </div>
      </div>
    </motion.div>
  );
}
