import { useEffect, useState } from 'react';
import { useGameStore } from '../store/game';
import { Chip, Icon, avatarInitial } from '../components/primitives';
import { getSocket } from '../lib/socket';
import { TopBar } from './TopBar';
import type { LobbyMode } from '@shared/types';

const MODE_FILTERS: ('all' | LobbyMode)[] = [
  'all',
  'classic',
  'blitz',
  'duel',
  'tournament',
];

export function LobbyBrowser() {
  const setRoute = useGameStore((s) => s.setRoute);
  const lobbies = useGameStore((s) => s.publicLobbies);
  const pushToast = useGameStore((s) => s.pushToast);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | LobbyMode>('all');

  useEffect(() => {
    getSocket().emit('lobby:list', (res) => {
      useGameStore.getState().setPublicLobbies(res.lobbies);
    });
  }, []);

  const filtered = lobbies.filter(
    (l) =>
      (mode === 'all' || l.mode === mode) &&
      (!q ||
        (l.name + l.code + l.hostName).toLowerCase().includes(q.toLowerCase()))
  );

  function join(code: string) {
    getSocket().emit('lobby:join', { code }, (res) => {
      if (!res.ok) {
        pushToast(res.error, 'warn');
        useGameStore.getState().setJoinError(res.error);
      }
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
      }}
    >
      <TopBar
        eyebrow="LIVE LOBBIES"
        title="Find a Table"
        onBack={() => setRoute('menu')}
        right={
          <>
            <Chip kind="live">{filtered.length} OPEN</Chip>
            <button className="btn sm primary" onClick={() => setRoute('create')}>
              <Icon name="plus" /> Create
            </button>
          </>
        }
      />

      <div
        className="glass"
        style={{
          padding: 0,
          display: 'grid',
          gridTemplateRows: 'auto auto 1fr',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: 16,
            alignItems: 'center',
            borderBottom: '1px solid var(--hairline)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 220px', position: 'relative' }}>
            <Icon
              name="search"
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-2)',
              }}
            />
            <input
              className="input"
              placeholder="Search by name, host, or code"
              style={{ paddingLeft: 42 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)',
              borderRadius: 10,
              border: '1px solid var(--hairline)',
              flexWrap: 'wrap',
            }}
          >
            {MODE_FILTERS.map((m) => (
              <button
                key={m}
                className="btn sm ghost"
                style={{
                  padding: '8px 12px',
                  background: mode === m ? 'var(--bg-3)' : 'transparent',
                  border:
                    mode === m
                      ? '1px solid var(--hairline-strong)'
                      : '1px solid transparent',
                  color: mode === m ? 'var(--ink-0)' : 'var(--ink-2)',
                }}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-row head">
          <div></div>
          <div>Table</div>
          <div className="hide-mobile">Mode</div>
          <div>Seats</div>
          <div className="hide-mobile">Status</div>
          <div></div>
        </div>

        <div className="scroll" style={{ minHeight: 0 }}>
          {filtered.map((l, i) => (
            <div
              key={l.code}
              className="lobby-row in"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  display: 'grid',
                  placeItems: 'center',
                  background:
                    'linear-gradient(160deg, color-mix(in oklab, var(--amber) 30%, var(--bg-3)), var(--bg-2))',
                  fontFamily: 'var(--f-display)',
                  fontSize: 16,
                  color: 'var(--amber)',
                }}
              >
                {avatarInitial(l.hostName)}
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {l.name}
                  {l.locked && (
                    <span
                      style={{
                        color: 'var(--ember)',
                        display: 'inline-flex',
                      }}
                    >
                      <Icon name="lock" size={13} />
                    </span>
                  )}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-3)' }}
                >
                  {l.code} · host {l.hostName}
                </div>
              </div>
              <div
                className="mono hide-mobile"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-2)',
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                }}
              >
                {l.mode}
              </div>
              <div className="mono" style={{ fontSize: 13 }}>
                <span
                  style={{
                    color:
                      l.playerCount >= l.maxPlayers
                        ? 'var(--ember)'
                        : 'var(--ink-0)',
                  }}
                >
                  {l.playerCount}
                </span>
                <span style={{ color: 'var(--ink-3)' }}>/{l.maxPlayers}</span>
              </div>
              <div
                className="mono hide-mobile"
                style={{
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: l.inGame
                    ? 'var(--ember)'
                    : 'oklch(0.75 0.18 145)',
                }}
              >
                <Icon name="wifi" size={14} /> {l.inGame ? 'in game' : 'open'}
              </div>
              <div>
                <button
                  className="btn sm primary"
                  disabled={l.playerCount >= l.maxPlayers || l.inGame}
                  onClick={() => join(l.code)}
                >
                  {l.inGame
                    ? 'IN GAME'
                    : l.playerCount >= l.maxPlayers
                    ? 'FULL'
                    : 'JOIN'}
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: 60,
                textAlign: 'center',
                color: 'var(--ink-3)',
              }}
            >
              No tables match. Try another search or{' '}
              <button
                className="btn ghost sm"
                onClick={() => setRoute('create')}
              >
                open one yourself
              </button>
              .
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
