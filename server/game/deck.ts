import type { Card, Rank } from '../../shared/types.ts';
import { HAND_SIZE } from '../../shared/types.ts';

export const RANKS: Rank[] = ['whiskey', 'gin', 'rum'];

/**
 * Deck composition: 14 of each call rank + 4 wilds = 46 cards.
 * Generous enough for an 8-player table (max 40 dealt) plus a few in the deck
 * for trust-chain refills.
 */
export function makeDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const r of RANKS) {
    for (let i = 0; i < 14; i++) cards.push({ id: id++, suit: r });
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, suit: 'wild' });
  return shuffle(cards);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function dealHands(
  alivePlayers: { hand: Card[]; out: boolean }[],
  deck: Card[]
): Card[] {
  const d = [...deck];
  for (const p of alivePlayers) {
    if (p.out) continue;
    p.hand = d.splice(0, HAND_SIZE);
  }
  return d;
}

export function pickRank(exclude?: Rank): Rank {
  const pool = exclude ? RANKS.filter((r) => r !== exclude) : RANKS;
  return pool[Math.floor(Math.random() * pool.length)];
}
