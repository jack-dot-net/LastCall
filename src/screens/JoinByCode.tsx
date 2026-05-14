import { useState } from 'react';
import { useGameStore } from '../store/game';
import { getSocket } from '../lib/socket';
import { TopBar } from './TopBar';
import { CODE_LEN } from '@shared/types';

export function JoinByCode() {
  const setRoute = useGameStore((s) => s.setRoute);
  const pushToast = useGameStore((s) => s.pushToast);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  function go() {
    if (code.length !== CODE_LEN || joining) return;
    setJoining(true);
    getSocket().emit('lobby:join', { code }, (res) => {
      setJoining(false);
      if (!res.ok) {
        pushToast(res.error, 'warn');
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
        eyebrow="GOT AN INVITE"
        title="Join by Code"
        onBack={() => setRoute('menu')}
      />
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <div
          className="glass in"
          style={{
            width: 460,
            maxWidth: 'calc(100vw - 32px)',
            padding: 32,
          }}
        >
          <div className="field">
            <label>{CODE_LEN}-Char Lobby Code</label>
            <input
              className="input code"
              maxLength={CODE_LEN}
              placeholder={'·'.repeat(CODE_LEN)}
              value={code}
              autoFocus
              inputMode="text"
              autoCapitalize="characters"
              onChange={(e) =>
                setCode(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, CODE_LEN)
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') go();
              }}
            />
          </div>
          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 18 }}
            disabled={code.length < CODE_LEN || joining}
            onClick={go}
          >
            {joining ? 'Knocking…' : 'Knock on the Door'}
          </button>
          <div
            style={{
              textAlign: 'center',
              marginTop: 14,
              color: 'var(--ink-3)',
              fontSize: 12,
            }}
          >
            Codes look like{' '}
            <span className="mono" style={{ color: 'var(--ink-1)' }}>
              EMBR42
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
