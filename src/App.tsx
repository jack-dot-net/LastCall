import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from './store/game';
import {
  getSocket,
  identify,
  loadStoredName,
  persistName,
} from './lib/socket';
import { Atmosphere } from './components/Atmosphere';
import { Menu } from './screens/Menu';
import { LobbyBrowser } from './screens/LobbyBrowser';
import { CreateLobby } from './screens/CreateLobby';
import { JoinByCode } from './screens/JoinByCode';
import { LobbyRoom } from './screens/LobbyRoom';
import { Game } from './screens/Game';
import { Settings } from './screens/Settings';
import { Modal } from './components/Modal';
import { Toaster } from './components/Toast';

export default function App() {
  const route = useGameStore((s) => s.route);
  const lobby = useGameStore((s) => s.lobby);
  const settingsOpen = useGameStore((s) => s.settingsOpen);
  const settings = useGameStore((s) => s.settings);

  // Connect & identify on mount
  useEffect(() => {
    const s = getSocket();
    const initialName = loadStoredName();
    useGameStore.setState({ playerName: initialName });

    function doIdentify() {
      identify(useGameStore.getState().playerName).then(
        (res) => {
          useGameStore.getState().setIdentity(res.playerId, res.name);
          persistName(res.name);
          // If reconnect dropped us into a lobby, store will receive lobby:state
          // shortly. Route accordingly when we see it.
        },
        (err) => {
          useGameStore.getState().pushToast(`Connection error: ${err.message}`, 'warn');
        }
      );
    }

    s.on('connect', () => {
      useGameStore.getState().setConnected(true);
      doIdentify();
    });
    s.on('disconnect', () => {
      useGameStore.getState().setConnected(false);
    });
    s.on('connect_error', () => {
      useGameStore.getState().setConnected(false);
    });

    s.on('lobby:state', ({ lobby: l }) => {
      const prev = useGameStore.getState().lobby;
      useGameStore.getState().setLobby(l);
      // Auto-route: if we have a lobby, we should be in lobby or game.
      const inGame = !!l.game && l.game.phase !== 'lobby';
      const desiredRoute = inGame ? 'game' : 'lobby';
      const currentRoute = useGameStore.getState().route;
      if (
        prev?.code !== l.code ||
        (currentRoute !== desiredRoute &&
          (currentRoute === 'menu' ||
            currentRoute === 'browser' ||
            currentRoute === 'create' ||
            currentRoute === 'join' ||
            currentRoute === 'lobby' ||
            currentRoute === 'game'))
      ) {
        useGameStore.getState().setRoute(desiredRoute);
      } else if (currentRoute === 'lobby' && inGame) {
        useGameStore.getState().setRoute('game');
      } else if (currentRoute === 'game' && !inGame && l.game?.phase !== 'match_end') {
        useGameStore.getState().setRoute('lobby');
      }
    });

    s.on('lobby:closed', ({ reason }) => {
      useGameStore.getState().pushToast(reason || 'Lobby closed.', 'warn');
      useGameStore.getState().reset();
      useGameStore.getState().setRoute('menu');
    });

    s.on('lobby:list', ({ lobbies }) => {
      useGameStore.getState().setPublicLobbies(lobbies);
    });

    s.on('hand:update', ({ hand }) => {
      useGameStore.getState().setHand(hand);
    });

    s.on('chat:message', (msg) => {
      useGameStore.getState().pushChat(msg);
    });

    s.on('game:event', (event) => {
      useGameStore.getState().handleGameEvent(event);
    });

    s.on('react', ({ fromSeat, emoji }) => {
      useGameStore.getState().setReaction(fromSeat, emoji);
      setTimeout(() => {
        const cur = useGameStore.getState().reactions;
        if (cur[fromSeat] === emoji) {
          const next = { ...cur };
          delete next[fromSeat];
          useGameStore.setState({ reactions: next });
        }
      }, 1600);
    });

    s.on('error', ({ message }) => {
      useGameStore.getState().pushToast(message, 'warn');
    });

    return () => {
      s.removeAllListeners();
    };
  }, []);

  // Apply reduced motion to root
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--motion-scale',
      settings.reducedMotion ? '0' : '1'
    );
  }, [settings.reducedMotion]);

  // Match-end overlay
  const matchEnded = lobby?.game?.phase === 'match_end';
  const winner =
    matchEnded && lobby?.game?.winnerId
      ? lobby.players.find((p) => p.id === lobby.game!.winnerId)
      : null;

  return (
    <>
      <Atmosphere />
      <AnimatePresence mode="wait">
        <motion.div
          key={route}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: settings.reducedMotion ? 0 : 0.22 }}
          style={{ position: 'fixed', inset: 0, zIndex: 2 }}
        >
          {route === 'menu' && <Menu />}
          {route === 'browser' && <LobbyBrowser />}
          {route === 'create' && <CreateLobby />}
          {route === 'join' && <JoinByCode />}
          {route === 'lobby' && <LobbyRoom />}
          {route === 'game' && <Game />}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {matchEnded && winner && (
          <motion.div
            key="match-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bell-stage"
            style={{ zIndex: 60 }}
          >
            <div
              className="glass"
              style={{
                width: 480,
                maxWidth: 'calc(100vw - 32px)',
                padding: 36,
                textAlign: 'center',
              }}
            >
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                LAST ONE STANDING
              </div>
              <div className="neon" style={{ fontSize: 56, marginBottom: 6 }}>
                {winner.name.toUpperCase()}
              </div>
              <div
                className="mono"
                style={{
                  color: 'var(--ink-2)',
                  letterSpacing: '.22em',
                  textTransform: 'uppercase',
                  fontSize: 11,
                  marginBottom: 28,
                }}
              >
                Closes the bar.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  className="btn ghost"
                  onClick={() => {
                    getSocket().emit('lobby:leave', () => {
                      useGameStore.getState().reset();
                      useGameStore.getState().setRoute('menu');
                    });
                  }}
                >
                  Back to Menu
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    // Rematch: leave & recreate? Simplest is to go back to lobby and re-ready.
                    getSocket().emit('lobby:leave', () => {
                      useGameStore.getState().reset();
                      useGameStore.getState().setRoute('menu');
                    });
                  }}
                >
                  Rematch
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={settingsOpen}
        title="House Rules · Settings"
        onClose={() => useGameStore.getState().setSettingsOpen(false)}
      >
        <Settings />
      </Modal>

      <Toaster />
    </>
  );
}
