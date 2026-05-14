import type { ReactNode } from 'react';
import { Icon } from '../components/primitives';

export function TopBar({
  title,
  eyebrow,
  onBack,
  right,
}: {
  title: string;
  eyebrow: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 28px',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        {onBack && (
          <button className="btn icon ghost" onClick={onBack} aria-label="Back">
            <Icon name="back" />
          </button>
        )}
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              letterSpacing: '.04em',
              color: 'var(--ink-0)',
            }}
          >
            {title}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {right}
      </div>
    </div>
  );
}
