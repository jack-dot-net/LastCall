import { type ReactNode } from 'react';
import { useGameStore } from '../store/game';
import { Slider, Switch } from '../components/primitives';

export function Settings() {
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Section title="Audio">
        <Row label="Master sound">
          <Switch
            on={settings.audio}
            onChange={(v) => setSettings({ audio: v })}
          />
        </Row>
        <Row label={`Ambient · ${settings.ambient}`}>
          <div style={{ width: 180 }}>
            <Slider
              value={settings.ambient}
              onChange={(v) => setSettings({ ambient: v })}
            />
          </div>
        </Row>
        <Row label={`Music · ${settings.music}`}>
          <div style={{ width: 180 }}>
            <Slider
              value={settings.music}
              onChange={(v) => setSettings({ music: v })}
            />
          </div>
        </Row>
        <Row label={`Sound FX · ${settings.sfx}`}>
          <div style={{ width: 180 }}>
            <Slider
              value={settings.sfx}
              onChange={(v) => setSettings({ sfx: v })}
            />
          </div>
        </Row>
      </Section>

      <Section title="Graphics">
        <Row label="Soft bloom">
          <Switch
            on={settings.bloom}
            onChange={(v) => setSettings({ bloom: v })}
          />
        </Row>
        <Row label="Smoke layer">
          <Switch
            on={settings.smoke}
            onChange={(v) => setSettings({ smoke: v })}
          />
        </Row>
        <Row label="Reduced motion">
          <Switch
            on={settings.reducedMotion}
            onChange={(v) => setSettings({ reducedMotion: v })}
          />
        </Row>
      </Section>

      <Section title="Gameplay">
        <Row label="Confirm before playing">
          <Switch
            on={settings.confirmPlay}
            onChange={(v) => setSettings({ confirmPlay: v })}
          />
        </Row>
        <Row label="Haptic feedback">
          <Switch
            on={settings.hapticFeedback}
            onChange={(v) => setSettings({ hapticFeedback: v })}
          />
        </Row>
      </Section>

      <div
        className="mono"
        style={{
          color: 'var(--ink-3)',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        Saved locally · v1.0
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 0',
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--ink-1)' }}>{label}</span>
      {children}
    </div>
  );
}
