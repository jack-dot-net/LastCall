import { useState } from 'react';
import { useGameStore } from '../store/game';
import { Icon, Slider } from '../components/primitives';
import { getSocket } from '../lib/socket';
import { TopBar } from './TopBar';
import type { CreateLobbyPayload, LobbyMode, Visibility } from '@shared/types';

const MODES: { value: LobbyMode; label: string; sub: string }[] = [
  { value: 'classic', label: 'Classic', sub: 'Long & loud' },
  { value: 'blitz', label: 'Blitz', sub: 'Fast turns' },
  { value: 'duel', label: 'Duel', sub: '1v1' },
  { value: 'tournament', label: 'Cup', sub: 'Bracket' },
];

export function CreateLobby() {
  const setRoute = useGameStore((s) => s.setRoute);
  const pushToast = useGameStore((s) => s.pushToast);
  const [form, setForm] = useState<CreateLobbyPayload>({
    name: '',
    mode: 'classic',
    maxPlayers: 6,
    lives: 3,
    visibility: 'public',
  });
  const [creating, setCreating] = useState(false);

  function update<K extends keyof CreateLobbyPayload>(
    k: K,
    v: CreateLobbyPayload[K]
  ) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit() {
    if (creating) return;
    setCreating(true);
    getSocket().emit('lobby:create', form, (res) => {
      setCreating(false);
      if (!res.ok) {
        pushToast(res.error, 'warn');
      }
      // success — lobby:state will route us in
    });
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        padding: '0 24px 24px',
        overflowY: 'auto',
      }}
    >
      <TopBar
        eyebrow="HOST A TABLE"
        title="Create Lobby"
        onBack={() => setRoute('menu')}
      />
      <div style={{ display: 'grid', placeItems: 'center', padding: '0 0 24px' }}>
        <div
          className="glass in"
          style={{
            width: 520,
            maxWidth: 'calc(100vw - 32px)',
            padding: 28,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="field">
              <label>Table Name</label>
              <input
                className="input"
                placeholder="The Velvet Ember"
                maxLength={40}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </div>

            <div className="field">
              <label>Game Mode</label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 8,
                }}
              >
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    className="btn ghost"
                    style={{
                      flexDirection: 'column',
                      padding: '12px 8px',
                      gap: 4,
                      background:
                        form.mode === m.value
                          ? 'color-mix(in oklab, var(--amber) 14%, transparent)'
                          : undefined,
                      borderColor:
                        form.mode === m.value ? 'var(--amber)' : undefined,
                      color:
                        form.mode === m.value
                          ? 'var(--ink-0)'
                          : 'var(--ink-1)',
                      boxShadow:
                        form.mode === m.value
                          ? '0 0 24px -6px color-mix(in oklab, var(--amber) 50%, transparent)'
                          : 'none',
                    }}
                    onClick={() => update('mode', m.value)}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{m.label}</div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 9,
                        color: 'var(--ink-3)',
                        textTransform: 'none',
                        letterSpacing: '.08em',
                      }}
                    >
                      {m.sub}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Max Players · {form.maxPlayers}</label>
              <Slider
                value={form.maxPlayers}
                min={2}
                max={8}
                onChange={(v) => update('maxPlayers', v)}
              />
            </div>

            <div className="field">
              <label>Lives per Player · {form.lives}</label>
              <Slider
                value={form.lives}
                min={1}
                max={5}
                onChange={(v) => update('lives', v)}
              />
            </div>

            <div className="field">
              <label>Visibility</label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                <button
                  className="btn ghost"
                  style={{
                    background:
                      form.visibility === 'public'
                        ? 'color-mix(in oklab, var(--amber) 14%, transparent)'
                        : undefined,
                    borderColor:
                      form.visibility === 'public' ? 'var(--amber)' : undefined,
                  }}
                  onClick={() => update('visibility', 'public' as Visibility)}
                >
                  <Icon name="globe" /> Public
                </button>
                <button
                  className="btn ghost"
                  style={{
                    background:
                      form.visibility === 'private'
                        ? 'color-mix(in oklab, var(--amber) 14%, transparent)'
                        : undefined,
                    borderColor:
                      form.visibility === 'private'
                        ? 'var(--amber)'
                        : undefined,
                  }}
                  onClick={() => update('visibility', 'private' as Visibility)}
                >
                  <Icon name="lock" /> Private
                </button>
              </div>
            </div>

            <button
              className="btn primary"
              style={{ marginTop: 4 }}
              disabled={creating}
              onClick={submit}
            >
              {creating ? 'Opening doors…' : 'Open the Doors'}{' '}
              {!creating && <Icon name="play" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
