import { useState } from 'react';
import { useGameStore } from '../store/game';
import { Chip, Icon, avatarInitial } from '../components/primitives';
import { Modal } from '../components/Modal';
import { identify, persistName } from '../lib/socket';
import { NAME_MAX } from '@shared/types';

export function Menu() {
  const setRoute = useGameStore((s) => s.setRoute);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);
  const playerName = useGameStore((s) => s.playerName);
  const setPlayerName = useGameStore((s) => s.setPlayerName);
  const onlineCount = useGameStore((s) => s.publicLobbies).reduce(
    (sum, l) => sum + l.playerCount,
    0
  );
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(playerName);

  function saveName() {
    const next = draftName.trim().slice(0, NAME_MAX) || 'Stranger';
    setPlayerName(next);
    persistName(next);
    identify(next).catch(() => {
      /* errors surface via toast */
    });
    setEditingName(false);
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '22px 28px',
          gap: 8,
        }}
      >
        <Chip kind="live">
          {onlineCount > 0
            ? `LIVE · ${onlineCount} ONLINE`
            : 'LIVE · DOORS OPEN'}
        </Chip>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn ghost sm"
            onClick={() => {
              setDraftName(playerName);
              setEditingName(true);
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'var(--bg-3)',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--f-display)',
                fontSize: 10,
                color: 'var(--amber)',
              }}
            >
              {avatarInitial(playerName)}
            </div>
            {playerName}
          </button>
          <button
            className="btn icon ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Icon name="gear" />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow in" style={{ marginBottom: 10 }}>
            EST. 2026 · jackdotnet
          </div>
          <h1
            className="neon in d1"
            style={{
              fontSize: 'clamp(72px, 12vw, 168px)',
              margin: 0,
              lineHeight: 0.9,
            }}
          >
            LAST
          </h1>
          <h1
            className="neon pink in d2"
            style={{
              fontSize: 'clamp(72px, 12vw, 168px)',
              margin: 0,
              lineHeight: 0.9,
              marginTop: -10,
            }}
          >
            CALL
          </h1>
          <p
            className="in d3"
            style={{
              marginTop: 18,
              color: 'var(--ink-2)',
              letterSpacing: '.18em',
              fontSize: 12,
              textTransform: 'uppercase',
            }}
          >
            A bluffing game for the patient, the patient-less, &amp; everyone in between
          </p>

          <div
            className="in d4"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              marginTop: 38,
              width: 'min(320px, 86vw)',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            <button className="btn primary" onClick={() => setRoute('browser')}>
              <Icon name="bolt" /> Quick Match
            </button>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}
            >
              <button className="btn" onClick={() => setRoute('create')}>
                <Icon name="plus" /> Create
              </button>
              <button className="btn" onClick={() => setRoute('join')}>
                <Icon name="users" /> Join Code
              </button>
            </div>
            <button
              className="btn ghost sm"
              onClick={() => setRoute('browser')}
            >
              Browse all tables →
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '20px 28px',
          color: 'var(--ink-3)',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '.2em',
          textTransform: 'uppercase',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span>v1.0 · build LC-2026</span>
        <span>
          server <span style={{ color: 'var(--amber)' }}>online</span>
        </span>
      </div>

      <Modal
        open={editingName}
        title="Your Tab"
        onClose={() => setEditingName(false)}
      >
        <div className="field">
          <label>Display Name</label>
          <input
            className="input"
            value={draftName}
            maxLength={NAME_MAX}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
            }}
            autoFocus
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 18,
          }}
        >
          <button className="btn primary sm" onClick={saveName}>
            Save
          </button>
        </div>
      </Modal>
    </div>
  );
}
