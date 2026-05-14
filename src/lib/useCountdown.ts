import { useEffect, useState } from 'react';

/**
 * Ticks an integer number of milliseconds remaining until `deadline`
 * (a ms-since-epoch timestamp). Returns 0 when no deadline or it's passed.
 * Cheap — re-renders ~5x per second only while a deadline is active.
 */
export function useCountdown(deadline: number | null | undefined): number {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, deadline - Date.now()) : 0
  );
  useEffect(() => {
    if (!deadline) {
      setRemaining(0);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setRemaining(Math.max(0, deadline - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [deadline]);
  return remaining;
}
