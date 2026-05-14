import type { CSSProperties, ReactNode, SVGProps } from 'react';

// ============================================================
// Icons — line icons, original
// ============================================================
export type IconName =
  | 'bolt'
  | 'globe'
  | 'lock'
  | 'users'
  | 'gear'
  | 'chat'
  | 'x'
  | 'back'
  | 'play'
  | 'copy'
  | 'check'
  | 'search'
  | 'send'
  | 'wifi'
  | 'skull'
  | 'fire'
  | 'minus'
  | 'plus'
  | 'logout';

export function Icon({
  name,
  size = 18,
  weight = 1.6,
  ...rest
}: { name: IconName; size?: number; weight?: number } & Omit<SVGProps<SVGSVGElement>, 'stroke'>) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: weight,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...rest,
  };
  switch (name) {
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-5.92" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-11.7 7.1L4 21l1.4-4.7A8 8 0 1 1 21 12Z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M6 18 18 6" />
        </svg>
      );
    case 'back':
      return (
        <svg {...common}>
          <path d="M15 18 9 12l6-6" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <path d="m7 5 12 7-12 7Z" fill="currentColor" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m4 12 5 5L20 6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />
        </svg>
      );
    case 'wifi':
      return (
        <svg {...common}>
          <path d="M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19" r="1" fill="currentColor" />
        </svg>
      );
    case 'skull':
      return (
        <svg {...common}>
          <path d="M12 3a8 8 0 0 0-8 8c0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6a8 8 0 0 0-8-8Z" />
          <circle cx="9" cy="11" r="1.4" fill="currentColor" />
          <circle cx="15" cy="11" r="1.4" fill="currentColor" />
        </svg>
      );
    case 'fire':
      return (
        <svg {...common}>
          <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-5 2 1 4 1 4-4Z" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...common}>
          <path d="M9 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5M16 17l5-5-5-5M21 12H9" />
        </svg>
      );
  }
}

// ============================================================
// Chip
// ============================================================
export function Chip({
  kind,
  children,
}: {
  kind?: 'live' | 'warn';
  children: ReactNode;
}) {
  return (
    <span className={`chip ${kind ?? ''}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

// ============================================================
// Switch
// ============================================================
export function Switch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!on);
        }
      }}
    />
  );
}

// ============================================================
// Slider
// ============================================================
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      className="range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--p' as string]: `${p}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

// ============================================================
// Avatar initial
// ============================================================
export function avatarInitial(name: string): string {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
