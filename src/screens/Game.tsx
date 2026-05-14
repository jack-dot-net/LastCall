import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { Chip, Icon, avatarInitial } from '../components/primitives';
import { GameCard } from '../components/Card';
import { BellOverlay } from '../components/BellOverlay';
import { RevealOverlay } from '../components/RevealOverlay';
import { getSocket } from '../lib/socket';
import { useCountdown } from '../lib/useCountdown';
import type { Card, PublicPlayer } from '@shared/types';

const REACTIONS = ['😏', '😱', '🥃', '🤥', '🎯'];

export function Game() {
  const lobby = useGameStore((s) => s.lobby);
  const hand = useGameStore((s) => s.hand);
  const playerId = useGameStore((s) => s.playerId);
  const speech = useGameStore((s) => s.speech);
  const reactions = useGameStore((s) => s.reactions);
  const pushToast = useGameStore((s) => s.pushToast);
  const setRoute = useGameStore((s) => s.setRoute);
  const reset = useGameStore((s) => s.reset);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [confirming, setConfirming] = useState<null | {
    cards: Card[];
  }>(null);

  // Prune card IDs that are no longer in our hand. The hand re-deals on a
  // new round (and auto-plays don't go through the explicit clear path), so
  // the selection set can otherwise hold stale IDs and report a phantom
  // "Selected: 3/3" when only one card is actually selected.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const handIds = new Set(hand.map((c) => c.id));
      let dirty = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (handIds.has(id)) next.add(id);
        else dirty = true;
      }
      return dirty ? next : prev;
    });
  }, [hand]);

  if (!lobby || !lobby.game) return null;
  const game = lobby.game;

  const me = lobby.players.find((p) => p.id === playerId);
  if (!me) return null;
  const mySeat = me.seat;

  const turnIsMine = game.turnSeat === mySeat;
  const inDecide = game.phase === 'decision';
  const inDeclare = game.phase === 'declare';
  // I can act (play cards) on my turn in either declare or decision phase.
  const canPlay = turnIsMine && (inDeclare || inDecide) && hand.length > 0 && !me.out;
  // LIAR is only available in the decision phase (something to challenge).
  const canCallLiar = turnIsMine && inDecide && !me.out;
  const mustCallLiar = canCallLiar && hand.length === 0;
  const isYourBell = game.turnSeat === mySeat && game.phase === 'bell';
  const lastPlayer = game.lastPlay
    ? lobby.players.find((p) => p.seat === game.lastPlay!.fromSeat)
    : null;

  // Countdown timers — server enforces these via auto-actions; we render
  // them locally so the player can see the pressure.
  const remainingMs = useCountdown(turnIsMine ? game.turnDeadline ?? null : null);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const bellPlayer =
    game.phase === 'bell'
      ? lobby.players.find((p) => p.seat === game.turnSeat) ?? null
      : null;

  // Reveal-phase derived players (for the RevealOverlay).
  const reveal = game.reveal;
  const revealCards =
    game.phase === 'reveal' && game.lastPlay?.cardsRevealed
      ? game.lastPlay.cardsRevealed
      : null;
  const revealBluffer =
    reveal && game.lastPlay
      ? lobby.players.find((p) => p.seat === game.lastPlay!.fromSeat) ?? null
      : null;
  const revealChallenger = reveal
    ? lobby.players.find((p) => p.seat === reveal.challengerSeat) ?? null
    : null;
  const revealLoser = reveal
    ? lobby.players.find((p) => p.seat === reveal.loserSeat) ?? null
    : null;

  // Seat positions — rotate so the local player sits at the bottom.
  const seatLayout = useMemo(() => {
    return computeSeatLayout(lobby.players, mySeat);
  }, [lobby.players.length, mySeat]);

  // ---------- actions ----------
  function leave() {
    getSocket().emit('lobby:leave', () => {
      reset();
      setRoute('menu');
    });
  }

  function toggleSelect(cardId: number) {
    if (!canPlay) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else if (next.size < 3) next.add(cardId);
      return next;
    });
  }

  function playSelected() {
    if (selected.size === 0 || !canPlay) return;
    const cards = hand.filter((c) => selected.has(c.id));
    if (useGameStore.getState().settings.confirmPlay) {
      setConfirming({ cards });
    } else {
      sendPlay([...selected]);
    }
  }

  function sendPlay(cardIds: number[]) {
    setConfirming(null);
    getSocket().emit('game:play', { cardIds }, (res) => {
      if (!res.ok) {
        pushToast(res.error, 'warn');
      } else {
        setSelected(new Set());
      }
    });
  }

  function callLiar() {
    if (!canCallLiar) return;
    getSocket().emit('game:callLiar', (res) => {
      if (!res.ok) pushToast(res.error, 'warn');
    });
  }

  function pullBell() {
    getSocket().emit('game:pullBell', (res) => {
      if (!res.ok) pushToast(res.error, 'warn');
    });
  }

  function react(emoji: string) {
    getSocket().emit('game:react', { emoji });
    useGameStore.getState().setReaction(mySeat, emoji);
    setTimeout(() => {
      const cur = useGameStore.getState().reactions;
      if (cur[mySeat] === emoji) {
        const next = { ...cur };
        delete next[mySeat];
        useGameStore.setState({ reactions: next });
      }
    }, 1600);
  }

  const callColorVar = `var(--${game.currentRank})`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        overflow: 'hidden',
      }}
    >
      {/* TOP HUD */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 18px',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn icon ghost" onClick={leave} aria-label="Leave">
            <Icon name="logout" />
          </button>
          <Chip>RND {game.round}</Chip>
          <Chip kind={game.phase === 'bell' ? 'warn' : 'live'}>
            {game.phase.toUpperCase().replace('_', ' ')}
          </Chip>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow">TONIGHT WE'RE POURING</div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 'clamp(20px, 4vw, 26px)',
              color: callColorVar,
              letterSpacing: '.08em',
              textShadow: `0 0 18px color-mix(in oklab, ${callColorVar} 60%, transparent)`,
            }}
          >
            {game.currentRank.toUpperCase()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn icon ghost"
            onClick={() => setChatOpen((v) => !v)}
            aria-label="Event log"
          >
            <Icon name="chat" size={16} />
          </button>
          <button
            className="btn icon ghost"
            onClick={() => useGameStore.getState().setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Icon name="gear" size={16} />
          </button>
        </div>
      </div>

      {/* TABLE */}
      <div
        style={{
          position: 'relative',
          margin: '0 12px',
          minHeight: 0,
          borderRadius: 18,
          overflow: 'hidden',
        }}
      >
        <div className="lamp" />
        <div className="table-felt" />

        {/* Pile */}
        <div className="pile">
          <div className="call">
            <div className="word" style={{ color: callColorVar }}>
              {game.currentRank.toUpperCase()}
            </div>
            <div className="sub">THE CALL</div>
          </div>
          <div className="stack">
            {game.lastPlay ? (
              game.lastPlay.cardsRevealed ? (
                game.lastPlay.cardsRevealed.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ rotateY: 180 }}
                    animate={{ rotateY: 0 }}
                    transition={{ delay: i * 0.18, duration: 0.5 }}
                    style={{
                      position: 'absolute',
                      left: i * 6,
                      top: i * 4,
                      transform: `rotate(${(i - 1) * 6}deg)`,
                    }}
                  >
                    <GameCard suit={c.suit} small />
                  </motion.div>
                ))
              ) : (
                Array.from({ length: game.lastPlay.count }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: i * 4,
                      top: i * 4,
                      transform: `rotate(${(i - 1) * 6}deg)`,
                    }}
                  >
                    <GameCard faceDown small />
                  </div>
                ))
              )
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  color: 'var(--ink-3)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '.25em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                  paddingTop: 56,
                }}
              >
                Pile
              </div>
            )}
          </div>
        </div>

        {/* Seats */}
        {seatLayout.map((entry) => {
          const p = entry.player;
          const youTag = p.id === playerId;
          const turnHere = game.turnSeat === p.seat && !p.out;
          return (
            <div
              key={p.id}
              className="seat"
              style={{
                left: `${entry.x}%`,
                top: `${entry.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {speech[p.seat] && (
                <div className="speech">{speech[p.seat]}</div>
              )}
              {reactions[p.seat] && (
                <div
                  className="speech"
                  style={{
                    top: -52,
                    fontSize: 22,
                    padding: '4px 10px',
                  }}
                >
                  {reactions[p.seat]}
                </div>
              )}
              <div
                className={`avatar ${turnHere ? 'active' : ''} ${
                  p.out ? 'out' : ''
                } ${p.isHost ? 'host' : ''} ${
                  p.connected ? '' : 'disc'
                }`}
              >
                {avatarInitial(p.name)}
              </div>
              <div className="name">
                {p.name}
                {youTag && (
                  <span
                    className="mono"
                    style={{
                      color: 'var(--amber)',
                      fontSize: 9,
                      letterSpacing: '.2em',
                    }}
                  >
                    YOU
                  </span>
                )}
              </div>
              <div className="meta">
                {Array.from({ length: lobby.lives }, (_, k) => (
                  <span
                    key={k}
                    className={`life ${k >= p.lives ? 'spent' : ''}`}
                  />
                ))}
              </div>
              {!youTag && !p.out && (
                <div
                  className="mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: '.22em',
                    color: 'var(--ink-3)',
                    marginTop: 2,
                  }}
                >
                  {p.handCount} CARDS
                </div>
              )}
              {p.out && (
                <div
                  className="mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: '.22em',
                    color: 'var(--ember)',
                    marginTop: 2,
                  }}
                >
                  OUT
                </div>
              )}
            </div>
          );
        })}

        {/* Reaction buttons */}
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {REACTIONS.map((e) => (
            <button
              key={e}
              className="btn icon ghost"
              style={{
                width: 36,
                height: 36,
                minHeight: 36,
                fontSize: 18,
                padding: 0,
              }}
              onClick={() => react(e)}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Action banner */}
        <AnimatePresence>
          {(canPlay || canCallLiar) && (
            <motion.div
              key={`${game.phase}-${mustCallLiar ? 'forced' : 'choose'}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 16,
                transform: 'translateX(-50%)',
                padding: '10px 18px',
                background: 'color-mix(in oklab, var(--amber) 16%, var(--bg-2))',
                border: '1px solid var(--amber)',
                borderRadius: 999,
                color: 'var(--ink-0)',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '.28em',
                textTransform: 'uppercase',
                boxShadow: 'var(--glow-amber)',
                whiteSpace: 'nowrap',
              }}
            >
              {mustCallLiar
                ? `No cards left — call LIAR · ${remainingSec}s`
                : inDeclare
                ? `Open the round · 1–3 ${game.currentRank} · ${remainingSec}s`
                : `Play 1–3 ${game.currentRank} or call LIAR · ${remainingSec}s`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* BOTTOM */}
      <div
        style={{
          padding: '12px 16px 20px',
          display: 'grid',
          gridTemplateRows: 'auto auto',
          gap: 12,
        }}
      >
        {me.out ? (
          <div
            className="mono"
            style={{
              textAlign: 'center',
              color: 'var(--ink-3)',
              letterSpacing: '.22em',
              textTransform: 'uppercase',
              fontSize: 11,
            }}
          >
            You're spectating · watching the rest fall
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'var(--ink-3)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '.2em',
                textTransform: 'uppercase',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span>Your tab · {hand.length} cards</span>
              <span>Selected: {selected.size}/3</span>
              <span>Pile: {game.pileSize}</span>
            </div>
            {canCallLiar && lastPlayer && (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--ink-2)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                }}
              >
                {lastPlayer.name} just played{' '}
                <span style={{ color: 'var(--ink-0)' }}>
                  {game.lastPlay?.count} · {game.lastPlay?.claimedRank}
                </span>
                . Play your own or shout LIAR.
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: 14,
                minHeight: 160,
                flexWrap: 'wrap',
              }}
            >
              <div className="hand">
                {hand.map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      transform: `rotate(${(i - (hand.length - 1) / 2) * 5}deg)`,
                    }}
                  >
                    <GameCard
                      suit={c.suit}
                      lifted={selected.has(c.id)}
                      onClick={() => toggleSelect(c.id)}
                    />
                  </div>
                ))}
                {hand.length === 0 && (
                  <div
                    style={{
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      letterSpacing: '.2em',
                      textTransform: 'uppercase',
                      padding: '40px 0',
                    }}
                  >
                    No cards left this round
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
                {canCallLiar && (
                  <button
                    className="btn danger"
                    style={{ height: 56, fontSize: 15 }}
                    onClick={callLiar}
                  >
                    <Icon name="fire" /> LIAR!
                  </button>
                )}
                <button
                  className="btn primary"
                  disabled={!canPlay || selected.size === 0}
                  style={{ height: canCallLiar ? 56 : 60, fontSize: 15 }}
                  onClick={playSelected}
                >
                  <Icon name="play" />{' '}
                  {selected.size > 0
                    ? `Play ${selected.size} as ${game.currentRank}`
                    : canPlay
                    ? 'Select cards'
                    : turnIsMine
                    ? 'No cards'
                    : 'Wait'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Reveal overlay — runs first, holds for REVEAL_PHASE_MS on the server */}
      <AnimatePresence>
        {game.phase === 'reveal' && reveal && revealCards && game.lastPlay && (
          <RevealOverlay
            cards={revealCards}
            claimedRank={game.lastPlay.claimedRank}
            claimedCount={game.lastPlay.count}
            lying={reveal.lying}
            bluffer={revealBluffer}
            challenger={revealChallenger}
            loser={revealLoser}
          />
        )}
      </AnimatePresence>

      {/* Bell overlay — takes over once the reveal phase finishes */}
      <AnimatePresence>
        {game.phase === 'bell' && bellPlayer && (
          <BellOverlay
            player={bellPlayer}
            isYou={isYourBell}
            result={game.bell}
            deadline={isYourBell ? game.turnDeadline ?? null : null}
            onPull={pullBell}
          />
        )}
      </AnimatePresence>

      {/* Confirm play modal */}
      <AnimatePresence>
        {confirming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 70,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(0,0,0,.55)',
              backdropFilter: 'blur(8px)',
            }}
            onClick={() => setConfirming(null)}
          >
            <div
              className="glass"
              style={{
                padding: 28,
                width: 380,
                maxWidth: 'calc(100vw - 32px)',
                textAlign: 'center',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="eyebrow">CONFIRM PLAY</div>
              <div
                style={{
                  fontFamily: 'var(--f-display)',
                  fontSize: 28,
                  margin: '10px 0 14px',
                  color: callColorVar,
                }}
              >
                {confirming.cards.length} ·{' '}
                {game.currentRank.toUpperCase()}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  marginBottom: 18,
                }}
              >
                Sure they're all{' '}
                <span style={{ color: 'var(--ink-1)' }}>
                  {game.currentRank}
                </span>
                ? No take-backs.
              </div>
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
              >
                <button
                  className="btn ghost"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={() => sendPlay(confirming.cards.map((c) => c.id))}
                >
                  Send it
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event log slide */}
      <AnimatePresence>
        {chatOpen && <EventLog onClose={() => setChatOpen(false)} />}
      </AnimatePresence>

    </div>
  );
}

interface SeatEntry {
  player: PublicPlayer;
  x: number;
  y: number;
}

function computeSeatLayout(
  players: PublicPlayer[],
  mySeat: number
): SeatEntry[] {
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const n = sorted.length;
  if (n === 0) return [];
  const meIdx = Math.max(
    0,
    sorted.findIndex((p) => p.seat === mySeat)
  );
  // Rotate so I'm first.
  const ordered = [...sorted.slice(meIdx), ...sorted.slice(0, meIdx)];
  return ordered.map((p, i) => {
    const t = i / n;
    // i=0 (me) → angle = pi/2 (bottom). Others spread CCW.
    const angle = Math.PI / 2 + t * Math.PI * 2;
    const x = 50 + Math.cos(angle) * 38;
    const y = 50 + Math.sin(angle) * 34;
    return { player: p, x, y };
  });
}

function EventLog({ onClose }: { onClose: () => void }) {
  const log = useGameStore((s) => s.log);
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.22 }}
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        maxWidth: '90vw',
        zIndex: 40,
        padding: 12,
      }}
    >
      <div
        className="glass"
        style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr' }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div className="eyebrow">EVENT LOG</div>
          <button
            className="btn icon ghost"
            onClick={onClose}
            aria-label="Close log"
          >
            <Icon name="x" />
          </button>
        </div>
        <div
          className="scroll"
          style={{
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {log.length === 0 && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                letterSpacing: '.18em',
                textAlign: 'center',
                paddingTop: 40,
              }}
            >
              Nothing happened yet.
            </div>
          )}
          {log.map((e) => (
            <div
              key={e.id}
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-2)',
                letterSpacing: '.06em',
              }}
            >
              · {e.text}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
