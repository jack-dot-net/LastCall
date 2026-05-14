import { useMemo } from 'react';
import { useGameStore } from '../store/game';

export function Atmosphere() {
  const smoke = useGameStore((s) => s.settings.smoke);
  const bloom = useGameStore((s) => s.settings.bloom);
  return (
    <>
      <div className="stage" />
      {smoke && <div className="smoke" />}
      {smoke && <div className="smoke b" />}
      {bloom && <Sparks count={14} />}
      <div className="vignette" />
    </>
  );
}

export function Sparks({ count = 12 }: { count?: number }) {
  const sparks = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        bottom: -5 - Math.random() * 30,
        dx: (Math.random() - 0.5) * 60,
        delay: Math.random() * 6,
        duration: 6 + Math.random() * 6,
      })),
    [count]
  );
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      {sparks.map((s, i) => (
        <span
          key={i}
          className="spark"
          style={{
            left: `${s.left}%`,
            bottom: `${s.bottom}%`,
            ['--dx' as string]: `${s.dx}px`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
