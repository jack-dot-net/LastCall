import type { CSSProperties } from 'react';
import type { Suit } from '@shared/types';

const SUIT_META: Record<Suit, { glyph: string; label: string }> = {
  whiskey: { glyph: 'W', label: 'Whiskey' },
  gin: { glyph: 'G', label: 'Gin' },
  rum: { glyph: 'R', label: 'Rum' },
  wild: { glyph: '★', label: 'Wild' },
};

export function GameCard({
  suit,
  faceDown,
  small,
  lifted,
  played,
  style,
  onClick,
}: {
  suit?: Suit;
  faceDown?: boolean;
  small?: boolean;
  lifted?: boolean;
  played?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  if (faceDown || !suit) {
    return (
      <div
        className={`card back ${small ? 'small' : ''}`}
        style={style}
        onClick={onClick}
      />
    );
  }
  const s = SUIT_META[suit];
  return (
    <div
      className={`card ${suit} ${small ? 'small' : ''} ${lifted ? 'lifted' : ''} ${played ? 'played' : ''}`}
      style={style}
      onClick={onClick}
    >
      <div className="pip tl">{s.glyph}</div>
      <div className="center">
        <div className="glyph">{s.glyph}</div>
      </div>
      <div className="label">{s.label.toUpperCase()}</div>
      <div className="pip br">{s.glyph}</div>
    </div>
  );
}
