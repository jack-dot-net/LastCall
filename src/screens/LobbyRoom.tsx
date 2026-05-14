import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { Chip, Icon, avatarInitial } from '../components/primitives';
import { getSocket } from '../lib/socket';
import { TopBar } from './TopBar';
import { CHAT_MAX } from '@shared/types';

export function LobbyRoom() {
  const lobby = useGameStore((s) => s.lobby);
  const playerId = useGameStore((s) => s.playerId);
  const chat = useGameStore((s) => s.chat);
  const pushToast = useGameStore((s) => s.pushToast);
  const setRoute = useGameStore((s) => s.setRoute);
  const reset = useGameStore((s) => s.reset);
  const [msg, setMsg] = useState('');
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chat]);

  if (!lobby) return null;
  const me = lobby.players.find((p) => p.id === playerId);
  if (!me) return null;
  const isHost = me.id === lobby.hostId;
  const readyCount = lobby.players.filter((p) => p.ready).length;
  const allReady = readyCount === lobby.players.length && lobby.players.length >= 2;

  function leave() {
    getSocket().emit('lobby:leave', () => {
      reset();
      setRoute('menu');
    });
  }

  function toggleReady() {
    getSocket().emit('lobby:setReady', { ready: !me!.ready }, (res) => {
      if (!res.ok) pushToast(res.error, 'warn');
    });
  }

  function start() {
    getSocket().emit('lobby:start', (res) => {
      if (!res.ok) pushToast(res.error, 'warn');
    });
  }

  function send() {
    const text = msg.trim();
    if (!text) return;
    getSocket().emit('chat:send', { text });
    setMsg('');
  }

  function copyCode() {
    navigator.clipboard?.writeText(lobby!.code).then(
      () => pushToast(`Copied ${lobby!.code}`, 'success'),
      () => pushToast('Copy failed', 'warn')
    );
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
        eyebrow={`LOBBY · ${lobby.mode.toUpperCase()}`}
        title={lobby.name}
        onBack={leave}
        right={
          <>
            <Chip>
              {lobby.players.length}/{lobby.maxPlayers} SEATED
            </Chip>
            <button className="btn sm ghost" onClick={copyCode}>
              <Icon name="copy" size={14} />{' '}
              <span className="mono">{lobby.code}</span>
            </button>
          </>
        }
      />

      <div className="lobby-grid">
        {/* Seats */}
        <div
          className="glass"
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div className="eyebrow">SEATED</div>
              <div
                style={{
                  fontFamily: 'var(--f-display)',
                  fontSize: 22,
                  color: 'var(--ink-0)',
                }}
              >
                Around the Table
              </div>
            </div>
            <div
              className="mono"
              style={{
                color: 'var(--ink-3)',
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
              }}
            >
              Lives: {lobby.lives} · Code{' '}
              <span style={{ color: 'var(--amber)' }}>{lobby.code}</span>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 14,
              alignContent: 'start',
              overflowY: 'auto',
            }}
          >
            {Array.from({ length: lobby.maxPlayers }, (_, i) => {
              const p = lobby.players[i];
              if (!p) {
                return (
                  <div
                    key={`empty-${i}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      padding: 18,
                      background: 'transparent',
                      border: '1px dashed var(--hairline)',
                      borderRadius: 14,
                      minHeight: 154,
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      letterSpacing: '.22em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Empty Seat
                  </div>
                );
              }
              const youTag = p.id === playerId;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                    padding: 18,
                    background:
                      'color-mix(in oklab, var(--bg-0) 30%, transparent)',
                    border:
                      '1px solid ' +
                      (p.ready
                        ? 'color-mix(in oklab, oklch(0.75 0.18 145) 50%, transparent)'
                        : 'var(--hairline)'),
                    borderRadius: 14,
                    position: 'relative',
                    boxShadow: p.ready
                      ? '0 0 24px -8px oklch(0.75 0.18 145)'
                      : 'none',
                  }}
                >
                  <div
                    className={`avatar ${p.isHost ? 'host' : ''} ${
                      p.connected ? '' : 'disc'
                    }`}
                  >
                    {avatarInitial(p.name)}
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}
                    {youTag && (
                      <span
                        className="mono"
                        style={{ color: 'var(--amber)', fontSize: 10 }}
                      >
                        YOU
                      </span>
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: '.22em',
                      color: !p.connected
                        ? 'var(--ember)'
                        : p.ready
                        ? 'oklch(0.75 0.18 145)'
                        : 'var(--ink-3)',
                    }}
                  >
                    {!p.connected ? 'RECONNECTING' : p.ready ? 'READY' : 'WAITING'}
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 16,
              borderTop: '1px solid var(--hairline)',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className={`btn ${me.ready ? 'ghost' : 'primary'}`}
                onClick={toggleReady}
              >
                {me.ready ? (
                  <>
                    <Icon name="check" /> Ready
                  </>
                ) : (
                  'Tap to Ready'
                )}
              </button>
              <span
                className="mono"
                style={{
                  color: 'var(--ink-3)',
                  fontSize: 11,
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                }}
              >
                {readyCount}/{lobby.players.length} ready
              </span>
            </div>
            {isHost ? (
              <button
                className="btn danger"
                disabled={!allReady}
                onClick={start}
                title={
                  !allReady
                    ? 'Everyone must be ready (min 2 players)'
                    : undefined
                }
              >
                <Icon name="fire" /> Start Round
              </button>
            ) : (
              <span
                className="mono"
                style={{
                  color: 'var(--ink-3)',
                  fontSize: 11,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                }}
              >
                Waiting for host…
              </span>
            )}
          </div>
        </div>

        {/* Chat */}
        <div
          className="glass"
          style={{
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Icon name="chat" size={16} />
            <div className="eyebrow">Bar Chatter</div>
          </div>
          <div
            ref={chatRef}
            className="scroll"
            style={{
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              minHeight: 0,
            }}
          >
            {chat.length === 0 && (
              <div
                className="mono"
                style={{
                  color: 'var(--ink-3)',
                  fontSize: 11,
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                  paddingTop: 40,
                }}
              >
                Be the first to say something.
              </div>
            )}
            {chat.map((c) => {
              const mine = c.fromId === playerId;
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    alignItems: mine ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: '.2em',
                      textTransform: 'uppercase',
                      color: c.system
                        ? 'var(--ink-3)'
                        : mine
                        ? 'var(--amber)'
                        : 'var(--ink-3)',
                    }}
                  >
                    {c.fromName}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      padding: '8px 12px',
                      borderRadius: 12,
                      maxWidth: '90%',
                      wordBreak: 'break-word',
                      background: c.system
                        ? 'color-mix(in oklab, var(--ink-0) 4%, transparent)'
                        : mine
                        ? 'color-mix(in oklab, var(--amber) 18%, transparent)'
                        : 'var(--bg-2)',
                      border: '1px solid var(--hairline)',
                      color: c.system ? 'var(--ink-2)' : 'var(--ink-1)',
                      fontStyle: c.system ? 'italic' : 'normal',
                    }}
                  >
                    {c.text}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              padding: 12,
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              gap: 8,
            }}
          >
            <input
              className="input"
              style={{ flex: 1, height: 40, fontSize: 14 }}
              placeholder="Say something…"
              maxLength={CHAT_MAX}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button
              className="btn icon primary"
              onClick={send}
              aria-label="Send"
            >
              <Icon name="send" size={16} />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .lobby-grid {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 16px;
          min-height: 0;
        }
        @media (max-width: 900px) {
          .lobby-grid { grid-template-columns: 1fr; }
          .lobby-grid > .glass:last-child { min-height: 240px; }
        }
      `}</style>
    </div>
  );
}
