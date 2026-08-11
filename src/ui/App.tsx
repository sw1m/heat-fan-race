import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  TOTAL_HEAT_CARDS,
  type PlayerColor,
} from '../engine/constants';
import { advanceBotTurns } from '../engine/bot';
import { applyGameAction, getPublicState, isOptionalDiscardCard } from '../engine/engine';
import { distanceToNextCorner, nextCorner } from '../engine/track';
import type { Card, GameAction, GameState } from '../engine/types';
import carMarkerAsset from '../assets/heat-race-car.png';
import {
  createRemoteRoom,
  ensureAnonymousIdentity,
  isSupabaseConfigured,
  joinRemoteRoom,
  loadRemoteRoom,
  leaveRemoteRoom,
  sendRemoteAction,
  startRemoteRoom,
  subscribeToRoom,
  type RemoteRoom,
  type RoomPlayer,
} from '../lib/supabase';
import {
  addLocalBotSeat,
  createLocalRoom,
  getLocalRoom,
  clearLocalRoom,
  startLocalRoom,
  type LocalRoom,
  setLocalRoom,
} from '../lib/local-session';
import {
  moveCardInOrder,
  reconcileCardOrder,
  sortCardsNumerically,
  type HandSortMode,
} from '../lib/hand-order';

type ActiveRoom = LocalRoom | RemoteRoom;

function isRemoteRoom(room: ActiveRoom): room is RemoteRoom {
  return 'id' in room;
}

function inviteLink(code: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

function roomPlayers(room: ActiveRoom): RoomPlayer[] {
  return room.players;
}

const CAR_COLOR_NAMES: Record<PlayerColor, string> = {
  '#d44735': 'Red',
  '#ee9a2f': 'Orange',
  '#245c8c': 'Blue',
  '#2f7a54': 'Green',
};

function carColorName(color: string): string {
  return CAR_COLOR_NAMES[color as PlayerColor] ?? 'Custom';
}

const CAR_MARKER_FILTERS: Record<string, string> = {
  '#d44735': 'hue-rotate(0deg) saturate(1.25) contrast(1.08)',
  '#ee9a2f': 'hue-rotate(42deg) saturate(1.35) brightness(1.05)',
  '#245c8c': 'hue-rotate(202deg) saturate(0.95)',
  '#2f7a54': 'hue-rotate(138deg) saturate(0.9)',
};

function carMarkerFilter(color: string): string {
  return (
    CAR_MARKER_FILTERS[color.toLowerCase()] ?? 'hue-rotate(0deg) saturate(1.25) contrast(1.08)'
  );
}

function heatAvailableLabel(engineHeat: number | undefined): string {
  const count = Math.max(0, Math.min(TOTAL_HEAT_CARDS, Math.round(engineHeat ?? 0)));
  return `${count}/${TOTAL_HEAT_CARDS}`;
}

type RacePositionPlayer = Pick<
  GameState['players'][number],
  'position' | 'finished' | 'finishProgress' | 'finishRank' | 'seat'
>;

function finishDistance(game: GameState, player: RacePositionPlayer): number {
  return Math.max(0, (player.finishProgress ?? player.position.space) - game.track.finishSpace);
}

function racePositionLabel(game: GameState, player: RacePositionPlayer): string {
  return player.finished ? `FINISH +${finishDistance(game, player)}` : `S${player.position.space}`;
}

function compareRacePositions(left: RacePositionPlayer, right: RacePositionPlayer): number {
  return (
    (left.finishRank ?? 99) - (right.finishRank ?? 99) ||
    (right.finishProgress ?? right.position.space) - (left.finishProgress ?? left.position.space) ||
    left.position.lane - right.position.lane ||
    left.seat - right.seat
  );
}

type RaceLogGroup = {
  key: string;
  round: number;
  label: string;
  entries: GameState['log'];
};

function summarizeRaceLog(game: GameState): RaceLogGroup[] {
  const names = new Map(game.players.map((player) => [player.id, player.name]));
  const groups = new Map<string, RaceLogGroup>();
  for (const entry of game.log) {
    const key = `${entry.round}:${entry.playerId ?? 'race-control'}`;
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
      continue;
    }
    groups.set(key, {
      key,
      round: entry.round,
      label: entry.playerId ? (names.get(entry.playerId) ?? 'Racer') : 'Race control',
      entries: [entry],
    });
  }
  return [...groups.values()];
}

function cardDisplayValue(card: Card): string {
  if (card.kind === 'STRESS') return 'STRESS';
  if (card.kind === 'HEAT' || card.kind === 'STARTING_HEAT') return 'HEAT';
  return String(card.value ?? 0);
}

function isNumericCard(card: Card): boolean {
  return card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE';
}

function cardTopSymbol(card: Card): string {
  if (isNumericCard(card)) return '◆';
  if (card.kind === 'STRESS') return '⚠️';
  return '🔥';
}

function CarToken({ color, className = '' }: { color: string; className?: string }): JSX.Element {
  return (
    <img
      className={`car-token ${className}`.trim()}
      src={carMarkerAsset}
      style={{ '--car-filter': carMarkerFilter(color) } as CSSProperties}
      alt=""
      aria-hidden="true"
    />
  );
}

function localPublicPlayers(game: GameState): RoomPlayer[] {
  const publicState = getPublicState(game, game.players[0]?.id ?? '');
  return publicState.players.map((player) => ({
    id: player.id,
    nickname: player.name,
    seat: player.seat,
    color: player.color,
    isHost: player.seat === 0,
    connected: true,
    submitted: player.submitted,
    position: player.position,
    gear: player.gear,
    engineHeat: player.engineHeat,
    handCount: player.handCount,
    deckCount: player.deckCount,
    discardCount: player.discardCount,
    finished: player.finished,
    finishRank: player.finishRank,
    isBot: player.controller === 'BOT',
  }));
}

export function App(): JSX.Element {
  const [identity, setIdentity] = useState('');
  const [room, setRoom] = useState<ActiveRoom | null>(null);
  const [screen, setScreen] = useState<'LANDING' | 'ROOM'>('LANDING');
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const queryCode = new URLSearchParams(window.location.search).get('room') ?? '';

  useEffect(() => {
    void ensureAnonymousIdentity()
      .then((next) => setIdentity(next.userId))
      .catch(() => setIdentity(crypto.randomUUID()));
    const saved = getLocalRoom();
    if (!isSupabaseConfigured && saved && (!queryCode || queryCode === saved.code)) {
      setRoom(saved);
      setScreen('ROOM');
    }
  }, [queryCode]);

  useEffect(() => {
    if (!room || !isRemoteRoom(room)) return undefined;
    return subscribeToRoom(room.id, () => {
      setReconnecting(true);
      void loadRemoteRoom(room.id)
        .then((next) => {
          setRoom(next);
          setReconnecting(false);
        })
        .catch(() => setReconnecting(false));
    });
  }, [room]);

  useEffect(() => {
    if (!room || isRemoteRoom(room) || !room.game) return;
    const game = advanceBotTurns(room.game);
    if (game === room.game) return;
    const next: LocalRoom = {
      ...room,
      game,
      status: game.phase === 'FINISHED' ? 'FINISHED' : 'RACING',
      players: localPublicPlayers(game),
    };
    setLocalRoom(next);
    setRoom(next);
  }, [room]);

  const createRoom = useCallback(
    async (nickname: string, color: PlayerColor) => {
      setError('');
      try {
        const next = isSupabaseConfigured
          ? await createRemoteRoom(nickname, color)
          : createLocalRoom(nickname, identity, color);
        setRoom(next);
        setScreen('ROOM');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not create the race room.');
      }
    },
    [identity],
  );

  const joinRoom = useCallback(
    async (nickname: string, code: string, color: PlayerColor) => {
      setError('');
      try {
        if (isSupabaseConfigured) {
          const next = await joinRemoteRoom(code, nickname, color);
          setRoom(next);
          setScreen('ROOM');
          return;
        }
        const saved = getLocalRoom();
        if (!saved || saved.code !== code.toUpperCase())
          throw new Error(
            'That room is not available in local preview mode. Configure Supabase for shared rooms.',
          );
        if (saved.status !== 'LOBBY') throw new Error('That room is already racing.');
        if (saved.players.length >= MAX_PLAYERS) throw new Error('That room is full.');
        if (saved.players.some((player) => player.color === color))
          throw new Error(
            `${carColorName(color)} is already taken in that room. Choose another car color.`,
          );
        const seat = saved.players.length;
        const next: LocalRoom = {
          ...saved,
          players: [
            ...saved.players,
            {
              id: identity,
              nickname,
              seat,
              color,
              isHost: false,
              connected: true,
              submitted: false,
            },
          ],
        };
        setLocalRoom(next);
        setRoom(next);
        setScreen('ROOM');
      } catch (cause) {
        const rawMessage = cause instanceof Error ? cause.message : '';
        const message = rawMessage.includes('COLOR_TAKEN')
          ? `${carColorName(color)} is already taken in that room. Choose another car color.`
          : rawMessage || 'Could not join the race room.';
        setError(message);
      }
    },
    [identity],
  );

  const onStart = useCallback(async () => {
    if (!room) return;
    setError('');
    try {
      const next = isRemoteRoom(room) ? await startRemoteRoom(room.id) : startLocalRoom(room);
      setRoom(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the race.');
    }
  }, [room]);

  const onAddBotSeat = useCallback(() => {
    if (!room || isRemoteRoom(room)) return;
    setRoom(addLocalBotSeat(room));
  }, [room]);

  const onAction = useCallback(
    async (action: GameAction) => {
      if (!room) return;
      setError('');
      try {
        if (isRemoteRoom(room)) {
          setRoom(await sendRemoteAction(room.id, action));
        } else if (room.game) {
          const game = applyGameAction(room.game, action);
          const next: LocalRoom = {
            ...room,
            game,
            status: game.phase === 'FINISHED' ? 'FINISHED' : 'RACING',
            players: localPublicPlayers(game),
          };
          setLocalRoom(next);
          setRoom(next);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That action is no longer legal.');
      }
    },
    [room],
  );

  const leaveRoom = useCallback(async () => {
    if (!room) return;
    setError('');
    try {
      if (isRemoteRoom(room)) await leaveRemoteRoom(room.id);
      else clearLocalRoom();
      setRoom(null);
      setScreen('LANDING');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not leave the room.');
    }
  }, [room]);

  const activeGame = room?.game ?? null;
  const activePlayers = room ? roomPlayers(room) : [];

  return screen === 'LANDING' || !room ? (
    <LandingScreen initialCode={queryCode} error={error} onCreate={createRoom} onJoin={joinRoom} />
  ) : (
    <RoomScreen
      room={room}
      identity={identity}
      game={activeGame}
      players={activePlayers}
      reconnecting={reconnecting}
      error={error}
      onStart={onStart}
      onAddBotSeat={onAddBotSeat}
      onAction={onAction}
      isHost={
        room.hostPlayerId === identity || (!isRemoteRoom(room) && room.players[0]?.id === identity)
      }
      onCopyInvite={() => void navigator.clipboard?.writeText(inviteLink(room.code))}
      onLeave={leaveRoom}
    />
  );
}

function LandingScreen({
  initialCode,
  error,
  onCreate,
  onJoin,
}: {
  initialCode: string;
  error: string;
  onCreate: (nickname: string, color: PlayerColor) => Promise<void>;
  onJoin: (nickname: string, code: string, color: PlayerColor) => Promise<void>;
}): JSX.Element {
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [color, setColor] = useState<PlayerColor>(PLAYER_COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function submit(kind: 'create' | 'join'): Promise<void> {
    if (!nickname.trim()) return;
    if (kind === 'join' && code.trim().length < 4) return;
    setBusy(true);
    if (kind === 'create') await onCreate(nickname.trim(), color);
    else await onJoin(nickname.trim(), code.trim().toUpperCase(), color);
    setBusy(false);
  }

  return (
    <main className="landing page-shell">
      <section className="hero-panel">
        <div className="eyebrow">PRIVATE RACE TABLE · V1</div>
        <h1>
          HEAT<span>·</span>
          <em>FAN RACE</em>
        </h1>
        <p className="hero-copy">
          A fast, friendly browser table for pushing your engine around a one-lap starter circuit.
        </p>
        <div className="disclaimer">
          <strong>Unofficial fan project.</strong> Not affiliated with or endorsed by Days of
          Wonder, Asmodee, or the game’s designers. For private, noncommercial games only.
        </div>
      </section>
      <section className="lobby-card landing-card" aria-label="Race lobby">
        <div className="panel-title">
          <span>ENTER THE PADDOCK</span>
          <span className="signal-dot">● READY</span>
        </div>
        <label className="field-label" htmlFor="nickname">
          Nickname
        </label>
        <input
          id="nickname"
          value={nickname}
          maxLength={20}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="e.g. Apex Annie"
          autoComplete="off"
        />
        <ColorPicker value={color} onChange={setColor} />
        <div className="button-row">
          <button
            className="primary-button"
            disabled={busy || !nickname.trim()}
            onClick={() => void submit('create')}
          >
            CREATE RACE
          </button>
          <div className="or-divider">OR</div>
          <button
            className="secondary-button"
            disabled={busy || !nickname.trim() || code.trim().length < 4}
            onClick={() => void submit('join')}
          >
            JOIN RACE
          </button>
        </div>
        <label className="field-label" htmlFor="room-code">
          Room code or invite link
        </label>
        <input
          id="room-code"
          value={code}
          maxLength={120}
          onChange={(event) => setCode(event.target.value.replace(/^.*room=/, '').toUpperCase())}
          placeholder="ABC123"
          autoComplete="off"
        />
        {error && (
          <div className="error-banner" role="alert">
            ⚠️ {error}
          </div>
        )}
        {!isSupabaseConfigured && (
          <div className="setup-banner">
            Local preview mode is active because Supabase keys are not configured. Add `.env.local`
            for shared realtime rooms.
          </div>
        )}
        <div className="rule-strip">
          <span>🏎️ 2–4 racers</span>
          <span>🔥 6 Heat</span>
          <span>🏁 1 lap</span>
          <span>⚙️ no accounts</span>
        </div>
      </section>
      <footer className="site-footer">
        Own the physical game before playing this fan implementation. No official artwork, logos,
        fonts, or generated images are used.
      </footer>
    </main>
  );
}

function ColorPicker({
  value,
  onChange,
  taken = [],
}: {
  value: PlayerColor;
  onChange: (color: PlayerColor) => void;
  taken?: readonly string[];
}): JSX.Element {
  return (
    <div className="color-picker" role="group" aria-label="Car color">
      <div className="color-picker-heading">
        <span className="field-label">Car color</span>
        <span className="helper-text">{carColorName(value)} car</span>
      </div>
      <div className="color-options">
        {PLAYER_COLORS.map((color) => {
          const unavailable = taken.includes(color);
          return (
            <button
              type="button"
              key={color}
              className={`color-option ${value === color ? 'color-selected' : ''}`}
              style={{ '--car-color': color } as CSSProperties}
              aria-label={`${carColorName(color)} car`}
              aria-pressed={value === color}
              disabled={unavailable}
              onClick={() => onChange(color)}
            >
              <span className="color-car">◆</span>
              <span>{carColorName(color)}</span>
              {unavailable && <small>TAKEN</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoomScreen({
  room,
  identity,
  game,
  players,
  reconnecting,
  error,
  onStart,
  onAddBotSeat,
  onAction,
  isHost,
  onCopyInvite,
  onLeave,
}: {
  room: ActiveRoom;
  identity: string;
  game: GameState | null;
  players: RoomPlayer[];
  reconnecting: boolean;
  error: string;
  onStart: () => Promise<void>;
  onAddBotSeat: () => void;
  onAction: (action: GameAction) => Promise<void>;
  isHost: boolean;
  onCopyInvite: () => void;
  onLeave: () => Promise<void>;
}): JSX.Element {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">⚡</span>
          <span>
            HEAT <small>FAN RACE</small>
          </span>
        </div>
        <div className="room-share">
          <span>
            ROOM <strong>{room.code}</strong>
          </span>
          <button className="tiny-button" onClick={onCopyInvite}>
            COPY INVITE LINK
          </button>
        </div>
        <div className={`connection ${reconnecting ? 'reconnecting' : ''}`}>
          ● {reconnecting ? 'RECONNECTING' : 'CONNECTED'}
        </div>
      </header>
      {error && (
        <div className="global-error" role="alert">
          ⚠️ {error}
        </div>
      )}
      {room.status === 'LOBBY' ? (
        <LobbyView
          room={room}
          players={players}
          isHost={isHost}
          onStart={onStart}
          onAddBotSeat={onAddBotSeat}
          onLeave={onLeave}
        />
      ) : game ? (
        <RaceView
          game={game}
          localPlayerId={identity}
          onAction={onAction}
          onLeave={onLeave}
          isHost={isHost}
          onRestart={onStart}
        />
      ) : (
        <div className="loading-card">Loading authoritative race state…</div>
      )}
    </main>
  );
}

function LobbyView({
  room,
  players,
  isHost,
  onStart,
  onAddBotSeat,
  onLeave,
}: {
  room: ActiveRoom;
  players: RoomPlayer[];
  isHost: boolean;
  onStart: () => Promise<void>;
  onAddBotSeat: () => void;
  onLeave: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="lobby-room page-shell">
      <div className="section-kicker">GRID ASSEMBLY / USA STARTER CIRCUIT</div>
      <div className="lobby-heading">
        <div>
          <h2>Choose your seat.</h2>
          <p>Share the code with friends. The host starts once two to four racers are ready.</p>
        </div>
        <div className="track-badge">
          🇺🇸 USA <small>1 LAP · LEARNING RACE</small>
        </div>
      </div>
      <div className="seat-grid">
        {Array.from({ length: MAX_PLAYERS }, (_, index) => {
          const player = players.find((candidate) => candidate.seat === index);
          return (
            <div className={`seat-card ${player ? 'occupied' : ''}`} key={index}>
              <div className="seat-number">0{index + 1}</div>
              <div className="seat-car">
                <CarToken color={player?.color ?? '#b9aa8e'} />
              </div>
              <div className="seat-name">{player ? player.nickname : 'OPEN SEAT'}</div>
              <div className="seat-status">
                {player
                  ? player.isBot
                    ? 'AI DRIVER · READY'
                    : player.isHost
                      ? 'HOST · READY'
                      : player.connected
                        ? 'CONNECTED'
                        : 'RECONNECTING'
                  : 'WAITING FOR RACER'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="lobby-actions">
        <div className="lobby-note">
          {!isRemoteRoom(room) && players.length < MAX_PLAYERS
            ? 'Solo test mode: add AI drivers, then start the race.'
            : `${players.length}/${MAX_PLAYERS} seats occupied.`}
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={() => void onLeave()}>
            LEAVE ROOM
          </button>
          {!isRemoteRoom(room) && players.length < MAX_PLAYERS && (
            <button className="secondary-button" onClick={onAddBotSeat}>
              ADD AI PLAYER
            </button>
          )}
          {isHost && (
            <button
              className="primary-button"
              disabled={players.length < MIN_PLAYERS}
              onClick={() => void onStart()}
            >
              START RACE
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RaceView({
  game,
  localPlayerId,
  onAction,
  onLeave,
  isHost,
  onRestart,
}: {
  game: GameState;
  localPlayerId: string;
  onAction: (action: GameAction) => Promise<void>;
  onLeave: () => Promise<void>;
  isHost: boolean;
  onRestart: () => Promise<void>;
}): JSX.Element {
  const local = game.players.find((player) => player.id === localPlayerId) ?? game.players[0];
  const pending = game.pending;
  const [gear, setGear] = useState(local.gear);
  const [selected, setSelected] = useState<string[]>([]);
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);
  const [handSort, setHandSort] = useState<HandSortMode>('NUMERICAL');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [reviewedFinish, setReviewedFinish] = useState(false);
  const handIdsKey = local.hand.map((card) => card.id).join('|');
  useEffect(() => {
    setGear(local.gear);
    setSelected([]);
    setDiscardSelection([]);
  }, [game.round, local.gear, pending?.playerId]);
  useEffect(() => {
    setManualOrder((current) => reconcileCardOrder(current, local.hand));
    setDiscardSelection((current) =>
      current.filter((cardId) => local.hand.some((card) => card.id === cardId)),
    );
  }, [handIdsKey, local.hand]);
  useEffect(() => {
    if (game.phase !== 'FINISHED') setReviewedFinish(false);
  }, [game.phase]);
  const active = game.activePlayerId === local.id;
  const publicState = getPublicState(game, local.id);
  const currentPublic = publicState.players.find((player) => player.id === local.id);
  const selectable = game.phase === 'PLANNING' && !game.submitted?.[local.id];
  const discardMode = active && pending?.kind === 'GEAR_REACTION';
  const inviteText = pending?.playerId === local.id ? pending.options : [];
  const handById = new Map(local.hand.map((card) => [card.id, card]));
  const displayHand =
    handSort === 'NUMERICAL'
      ? sortCardsNumerically(local.hand)
      : reconcileCardOrder(manualOrder, local.hand)
          .map((cardId) => handById.get(cardId))
          .filter((card): card is Card => Boolean(card));
  const selectCard = (cardId: string) =>
    setSelected((old) =>
      old.includes(cardId)
        ? old.filter((id) => id !== cardId)
        : old.length < gear
          ? [...old, cardId]
          : old,
    );
  const selectDiscardCard = (card: Card) => {
    if (!discardMode || !isOptionalDiscardCard(card)) return;
    setDiscardSelection((old) =>
      old.includes(card.id) ? old.filter((id) => id !== card.id) : [...old, card.id],
    );
  };
  const dropCard = (targetId: string) => {
    if (!draggingCardId) return;
    setManualOrder((current) =>
      moveCardInOrder(reconcileCardOrder(current, local.hand), draggingCardId, targetId),
    );
    setHandSort('MANUAL');
    setDraggingCardId(null);
  };
  const action = (type: GameAction['type']) =>
    void onAction({ type, playerId: local.id } as GameAction);

  return (
    <section className="race-layout page-shell">
      <div className="race-statusbar">
        <div>
          <span className="phase-label">ROUND {game.round}</span>
          <strong>{game.phase.replaceAll('_', ' ')}</strong>
        </div>
        <div className="active-callout">
          {active
            ? `YOUR MOVE · ${pending?.kind.replaceAll('_', ' ') ?? 'PLANNING'}`
            : game.activePlayerId
              ? `${game.players.find((player) => player.id === game.activePlayerId)?.name ?? 'A racer'} is resolving`
              : 'All racers choose simultaneously'}
        </div>
        <button className="tiny-button" onClick={() => void onLeave()}>
          LEAVE ROOM
        </button>
      </div>
      <TrackBoard game={game} />
      <div className="lower-grid">
        <aside className="panel standings-panel">
          <div className="panel-title">
            <span>STANDINGS</span>
            <span className="muted">INSIDE LANE BREAKS TIES</span>
          </div>
          {[...publicState.players].sort(compareRacePositions).map((player, index) => (
            <div
              className={`stand-row ${player.id === local.id ? 'local-row' : ''}`}
              key={player.id}
            >
              <span className="stand-rank">{player.finishRank ?? index + 1}</span>
              <span className="stand-car">
                <CarToken color={player.color} />
              </span>
              <span className="stand-name">
                {player.controller === 'BOT' ? '🤖 ' : ''}
                {player.name}
                {player.id === local.id ? ' (you)' : ''}
              </span>
              <span className="stand-stats">
                <span>⚙️ G{player.gear}</span>
                <span>🔥 {heatAvailableLabel(player.engineHeat)}</span>
              </span>
              <span className="stand-position">{racePositionLabel(game, player)}</span>
            </div>
          ))}
        </aside>
        <section className="panel driver-panel">
          <div className="panel-title">
            <span>YOUR DASHBOARD</span>
            <span className="muted">{local.name}</span>
          </div>
          <div className="metrics">
            <Metric label="GEAR" value={`⚙️ ${local.gear}`} />
            <Metric
              label="HEAT AVAILABLE"
              value={`🔥 ${heatAvailableLabel(local.engine.length)}`}
            />
            <Metric
              label="DRAW / DISCARD"
              value={`${local.deck.length} / ${local.discard.length}`}
            />
            <Metric
              label="POSITION"
              value={currentPublic?.finished ? '🏁 FINISH' : `SPACE ${local.position.space}`}
            />
          </div>
          <div className="gear-picker">
            <div className="field-label">SHIFT TO</div>
            <div className="gear-buttons">
              {[1, 2, 3, 4].map((value) => (
                <button
                  key={value}
                  className={gear === value ? 'gear-selected' : ''}
                  disabled={!selectable}
                  onClick={() => setGear(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="helper-text">
              {selectable
                ? Math.abs(gear - local.gear) === 2
                  ? 'Two-position shift costs 1 Heat.'
                  : 'Normal shift: one gear position.'
                : 'Gear is locked for this phase.'}
            </span>
            <span className="helper-text">
              BOOST: gear 3–4, pay 1 Heat, reveal a Basic Speed card.
            </span>
          </div>
        </section>
      </div>
      <section className="panel hand-panel">
        <div className="panel-title">
          <span>
            YOUR HAND{' '}
            <small>
              SELECT {gear} CARD{gear === 1 ? '' : 'S'}
            </small>
          </span>
          <span className="muted">
            {selectable
              ? `${selected.length}/${gear} SELECTED`
              : discardMode
                ? `${discardSelection.length} TO DISCARD`
                : 'CARDS LOCKED'}
          </span>
        </div>
        <div className="hand-toolbar">
          <div className="hand-sort-controls" role="group" aria-label="Hand order">
            <span className="helper-text">ORDER</span>
            <button
              type="button"
              className={`hand-sort-button ${handSort === 'MANUAL' ? 'sort-selected' : ''}`}
              onClick={() => setHandSort('MANUAL')}
            >
              MANUAL ORDER
            </button>
            <button
              type="button"
              className={`hand-sort-button ${handSort === 'NUMERICAL' ? 'sort-selected' : ''}`}
              onClick={() => setHandSort('NUMERICAL')}
            >
              NUMERICAL
            </button>
          </div>
          <span className="helper-text">
            {discardMode
              ? 'Optional discard: click numeric cards, then confirm below. Heat and Stress stay in hand.'
              : handSort === 'MANUAL'
                ? 'Drag cards to arrange them.'
                : '0 → 5, then Heat, then Stress.'}
          </span>
        </div>
        <div className="hand-row">
          {displayHand.map((card) => (
            <button
              type="button"
              className={`card card-${card.kind.toLowerCase()} ${isNumericCard(card) ? 'card-number' : ''} ${selected.includes(card.id) ? 'card-selected' : ''} ${discardSelection.includes(card.id) ? 'card-discard-selected' : ''}`}
              disabled={!selectable && !(discardMode && isOptionalDiscardCard(card))}
              draggable={handSort === 'MANUAL' && selectable}
              key={card.id}
              onClick={() => {
                if (selectable) selectCard(card.id);
                else selectDiscardCard(card);
              }}
              onDragStart={() => setDraggingCardId(card.id)}
              onDragOver={(event) => {
                if (handSort === 'MANUAL') event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropCard(card.id);
              }}
              onDragEnd={() => setDraggingCardId(null)}
              title={`${cardDisplayValue(card)} card${handSort === 'MANUAL' ? ' — drag to reorder' : ''}`}
            >
              <span className="card-symbol">{cardTopSymbol(card)}</span>
              <strong>
                {isNumericCard(card)
                  ? card.value
                  : card.kind === 'STRESS'
                    ? 'STRESS'
                    : card.kind.replace('STARTING_', '')}
              </strong>
              <small>
                {card.kind === 'BASIC'
                  ? 'BASIC SPEED'
                  : card.kind === 'STRESS'
                    ? 'RANDOM SPEED'
                    : 'STARTER'}
              </small>
            </button>
          ))}
        </div>
        <div className="played-card-tray" aria-label="Played cards awaiting discard">
          <div>
            <strong>PLAYED THIS TURN</strong>
            <span>
              {discardMode
                ? 'Played cards discard automatically; you may also discard numeric cards from hand.'
                : local.played.length > 0
                  ? 'Played cards discard automatically when you end the turn.'
                  : 'No cards are waiting to be discarded.'}
            </span>
          </div>
          <div className="played-card-list">
            {local.played.length > 0 ? (
              local.played.map((card) => (
                <span className="played-card-chip" key={card.id}>
                  <b>{cardTopSymbol(card)}</b> {cardDisplayValue(card)}
                </span>
              ))
            ) : (
              <span className="played-card-empty">—</span>
            )}
          </div>
        </div>
        <button
          className="primary-button lock-button"
          disabled={!selectable || selected.length !== gear}
          onClick={() =>
            void onAction({ type: 'SUBMIT_PLAN', playerId: local.id, gear, cardIds: selected })
          }
        >
          LOCK IN PLAN
        </button>
      </section>
      <section className="reaction-panel">
        <div className="reaction-title">
          {pending?.playerId === local.id ? 'ACTION REQUIRED' : 'RACE CONTROL'}{' '}
          <span>
            {pending?.playerId === local.id
              ? 'Choose an option or pass to keep the race moving.'
              : 'Cards resolve from the frontmost car to the last.'}
          </span>
        </div>
        {pending?.playerId === local.id && (
          <div className="reaction-actions">
            {inviteText.includes('ADRENALINE_SPEED') && (
              <button
                className="action-button action-yellow"
                onClick={() => action('ADRENALINE_SPEED')}
              >
                ⚡ ADRENALINE +1
              </button>
            )}
            {inviteText.includes('ADRENALINE_COOLDOWN') && (
              <button
                className="action-button action-blue"
                onClick={() => action('ADRENALINE_COOLDOWN')}
              >
                ❄ ADRENALINE COOL
              </button>
            )}
            {inviteText.includes('BOOST') && (
              <button className="action-button action-red" onClick={() => action('BOOST')}>
                💨 BOOST · PAY 1 HEAT
              </button>
            )}
            {inviteText.includes('COOLDOWN') && (
              <button className="action-button action-blue" onClick={() => action('COOLDOWN')}>
                ❄ COOLDOWN
              </button>
            )}
            {inviteText.includes('SLIPSTREAM') && (
              <button className="action-button action-yellow" onClick={() => action('SLIPSTREAM')}>
                💨 SLIPSTREAM 2
              </button>
            )}
            {pending?.kind === 'GEAR_REACTION' && discardSelection.length > 0 && (
              <button
                className="action-button action-red"
                onClick={() =>
                  void onAction({
                    type: 'DISCARD_CARDS',
                    playerId: local.id,
                    cardIds: discardSelection,
                  })
                }
              >
                DISCARD {discardSelection.length} + END TURN
              </button>
            )}
            <button
              className="action-button action-neutral"
              onClick={() => action('PASS_REACTION')}
            >
              {pending?.kind === 'ADRENALINE' ? 'SKIP ADRENALINE' : 'KEEP HAND + END TURN'}
            </button>
          </div>
        )}
      </section>
      <section className="panel log-panel">
        <div className="panel-title">
          <span>RACE LOG</span>
          <span className="muted">AUTHORITATIVE EVENTS</span>
        </div>
        <div className="log-list">
          {summarizeRaceLog(game).map((group) => (
            <details className="log-group" key={group.key}>
              <summary>
                <span>R{group.round}</span>
                <strong>{group.label}</strong>
                <span className="log-summary-text">
                  {group.entries[0]?.text}
                  {group.entries.length > 1 ? ` (+${group.entries.length - 1} more)` : ''}
                </span>
                <small>
                  {group.entries.length} event{group.entries.length === 1 ? '' : 's'}
                </small>
              </summary>
              <div className="log-group-details">
                {group.entries.map((entry) => (
                  <div className="log-entry" key={entry.id}>
                    <span>R{entry.round}</span>
                    <p>{entry.text}</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
      {game.phase === 'FINISHED' && !reviewedFinish && (
        <div className="finish-overlay">
          <div className="finish-card">
            <div className="finish-flag">🏁</div>
            <div className="eyebrow">CHECKERED FLAG</div>
            <h2>
              {game.winnerId === local.id
                ? 'YOU TAKE THE WIN'
                : `${game.players.find((player) => player.id === game.winnerId)?.name ?? 'The leader'} wins`}
            </h2>
            <p>
              The winner and each car&apos;s end-of-turn landing are locked. Review the table, then
              the host can start a new race.
            </p>
            <div className="final-list">
              {[...game.players].sort(compareRacePositions).map((player, index) => (
                <div key={player.id}>
                  <strong>{player.finishRank ?? index + 1}.</strong>{' '}
                  <CarToken color={player.color} /> <span>{player.name}</span>{' '}
                  <small>{racePositionLabel(game, player)}</small>
                </div>
              ))}
            </div>
            <div className="button-row finish-actions">
              <button className="primary-button" onClick={() => setReviewedFinish(true)}>
                REVIEW RACE
              </button>
              {isHost && (
                <button className="secondary-button" onClick={() => void onRestart()}>
                  NEW RACE
                </button>
              )}
              <button className="secondary-button" onClick={() => void onLeave()}>
                LEAVE ROOM
              </button>
            </div>
          </div>
        </div>
      )}
      {game.phase === 'FINISHED' && reviewedFinish && (
        <section className="panel finish-review-bar">
          <div>
            <div className="eyebrow">RACE REVIEW</div>
            <strong>
              {game.players.find((player) => player.id === game.winnerId)?.name ?? 'The leader'}{' '}
              won. The remaining cars are frozen at their end-of-turn spaces.
            </strong>
          </div>
          <div className="button-row">
            {isHost ? (
              <button className="primary-button" onClick={() => void onRestart()}>
                NEW RACE
              </button>
            ) : (
              <span className="helper-text">WAITING FOR THE HOST TO START A NEW RACE</span>
            )}
            <button className="secondary-button" onClick={() => void onLeave()}>
              LEAVE ROOM
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const TURN_STEPS = [
  {
    label: 'SHIFT + CARDS',
    short: 'SHIFT',
    title: '1. Shift and choose cards',
    details: [
      'Choose a gear from 1 through 4. A normal shift moves one position; a two-position shift costs 1 Heat.',
      'Select exactly as many cards as the chosen gear. All racers lock their choices before movement begins.',
    ],
  },
  {
    label: 'SPEED + MOVE',
    short: 'MOVE',
    title: '2. Reveal speed and move',
    details: [
      'Reveal the selected cards and add their Speed. Stress reveals cards until a Basic Speed card is found.',
      'Move in race order, placing the car in a legal landing space while respecting blocking, lanes, and the finish line.',
    ],
  },
  {
    label: 'REACTIONS',
    short: 'REACT',
    title: '3. Resolve reactions',
    details: [
      'The active racer may use available Adrenaline, Boost, Cooldown, or Slipstream actions, then passes to finish the turn.',
      'Corner speed is checked after all movement for that racer. Heat can be paid; otherwise the car spins out.',
    ],
  },
  {
    label: 'CLEANUP',
    short: 'CLEAN',
    title: '4. Discard and start the next round',
    details: [
      'Played cards go to the discard pile automatically when the racer finishes the reaction step.',
      'Draw back to seven cards, rank any finishers, then begin the next simultaneous planning step.',
    ],
  },
] as const;

function currentTurnStep(phase: GameState['phase']): number {
  if (phase === 'PLANNING') return 0;
  if (phase === 'RESOLVING_PLAYER') return 1;
  if (phase === 'PLAYER_REACTION') return 2;
  return 3;
}

function orderedTurnPlayers(game: GameState): GameState['players'] {
  const playersById = new Map(game.players.map((player) => [player.id, player]));
  if (game.resolutionOrder.length > 0) {
    return game.resolutionOrder
      .map((playerId) => playersById.get(playerId))
      .filter((player): player is GameState['players'][number] => Boolean(player));
  }
  return [...game.players]
    .filter((player) => !player.finished)
    .sort(
      (left, right) =>
        right.position.space - left.position.space ||
        left.position.lane - right.position.lane ||
        left.seat - right.seat,
    );
}

function TurnOrderGraphic({ game }: { game: GameState }): JSX.Element {
  const step = currentTurnStep(game.phase);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const raceFinished = game.phase === 'FINISHED';
  const order = orderedTurnPlayers(game);
  const activePlayers = game.players.filter((player) => !player.finished);
  const leaderSpace = raceFinished
    ? game.track.finishSpace
    : Math.max(...activePlayers.map((player) => player.position.space), 0);
  const upcomingCorner = game.track.corners.find((corner) => corner.lineSpace > leaderSpace);

  return (
    <div className="turn-order-graphic" aria-label="Turn order and corner progress">
      <div className="turn-order-heading">
        <span>TURN ORDER</span>
        <span className="muted">
          {raceFinished ? 'RACE COMPLETE' : `STEP ${step + 1} OF ${TURN_STEPS.length}`}
        </span>
      </div>
      <div className="turn-step-row">
        {TURN_STEPS.map((turn, index) => {
          const status = raceFinished
            ? 'complete'
            : index < step
              ? 'complete'
              : index === step
                ? 'active'
                : 'upcoming';
          return (
            <button
              type="button"
              className={`turn-step ${status} ${expandedStep === index ? 'expanded' : ''}`}
              key={turn.short}
              aria-expanded={expandedStep === index}
              onClick={() => setExpandedStep((current) => (current === index ? null : index))}
            >
              <span className="turn-step-number">{index + 1}</span>
              <strong>{turn.short}</strong>
              <small>{turn.label}</small>
            </button>
          );
        })}
      </div>
      {expandedStep !== null && (
        <div className="turn-step-breakdown">
          <div className="turn-step-breakdown-heading">
            <strong>{TURN_STEPS[expandedStep].title}</strong>
            <button type="button" onClick={() => setExpandedStep(null)}>
              CLOSE
            </button>
          </div>
          <ul>
            {TURN_STEPS[expandedStep].details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="turn-order-row">
        <span className="turn-order-label">RACE ORDER</span>
        <div className="resolution-order">
          {order.map((player, index) => {
            const complete =
              raceFinished ||
              game.phase === 'ROUND_CLEANUP' ||
              (game.resolutionOrder.length > 0 && index < game.resolutionIndex);
            const active = !complete && game.activePlayerId === player.id;
            const locked = game.phase === 'PLANNING' && Boolean(game.submitted[player.id]);
            return (
              <span
                className={`resolution-chip ${complete ? 'complete' : active ? 'active' : locked ? 'locked' : 'upcoming'}`}
                key={player.id}
              >
                <b>{index + 1}</b> {player.name}
                {locked && <small>LOCKED</small>}
              </span>
            );
          })}
        </div>
      </div>
      <div className="turn-order-row corner-progress-row">
        <span className="turn-order-label">CORNER PROGRESS</span>
        <div className="corner-progress">
          {game.track.corners.map((corner) => {
            const complete = leaderSpace >= corner.lineSpace;
            const active = !complete && upcomingCorner?.id === corner.id;
            return (
              <span
                className={`corner-progress-chip ${complete ? 'complete' : active ? 'active' : 'upcoming'}`}
                key={corner.id}
              >
                {corner.label} · S{corner.lineSpace}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrackBoard({ game }: { game: GameState }): JSX.Element {
  const positions = new Map(
    game.players.map((player) => [`${player.position.space}-${player.position.lane}`, player]),
  );
  const startingSpace = Math.min(0, ...game.track.grid.map((position) => position.space));
  const furthestVisibleSpace = Math.max(
    game.track.finishSpace + game.players.length,
    ...game.players.map((player) => player.position.space),
  );
  const trackSpaces = Array.from(
    { length: furthestVisibleSpace - startingSpace + 1 },
    (_, index) => startingSpace + index,
  );
  return (
    <section className="track-panel panel">
      <TurnOrderGraphic game={game} />
      <div className="track-head">
        <div>
          <div className="panel-title">
            <span>USA STARTER CIRCUIT</span>
            <span className="muted">TWO LANES · MAX TWO CARS PER SPACE</span>
          </div>
          <div className="track-legend">
            <span>🏁 FINISH S40</span>
            {game.track.corners.map((corner) => (
              <span key={corner.id}>
                ◼ {corner.label} <strong>{corner.speedLimit}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="corner-next">
          {game.track.corners.find(
            (corner) =>
              corner.lineSpace >
              (game.players.find((player) => !player.finished)?.position.space ?? 0),
          )
            ? `NEXT LIMIT ${game.track.corners.find((corner) => corner.lineSpace > (game.players.find((player) => !player.finished)?.position.space ?? 0))?.speedLimit}`
            : 'FINAL STRAIGHT'}
        </div>
      </div>
      <div className="track-scroll">
        <div
          className="track-grid"
          style={{ '--track-space-count': trackSpaces.length } as CSSProperties}
        >
          {[0, 1].map((lane) => (
            <div className="track-lane" key={lane}>
              <div className="lane-label">{lane === 0 ? 'RACE LINE' : 'OUTSIDE'}</div>
              {trackSpaces.map((space) => {
                const player = positions.get(`${space}-${lane}`);
                const corner = game.track.corners.find(
                  (candidate) => candidate.lineSpace === space,
                );
                return (
                  <div
                    className={`track-space ${space < 0 ? 'starting-space' : ''} ${corner ? 'corner-space' : ''} ${space === game.track.finishSpace ? 'finish-space' : ''} ${space > game.track.finishSpace ? 'post-finish-space' : ''}`}
                    key={space}
                  >
                    {corner && <span className="corner-marker">{corner.speedLimit}</span>}
                    {player && (
                      <span className="car-marker-wrap" title={player.name}>
                        <span className="car-distance">
                          {player.finished
                            ? `FINISH +${finishDistance(game, player)}`
                            : distanceToNextCorner(game.track, player.position.space) !== null
                              ? `${distanceToNextCorner(game.track, player.position.space)} TO ${nextCorner(game.track, player.position.space)?.label.replace('Turn ', 'T')}`
                              : `TO FINISH ${game.track.finishSpace - player.position.space}`}
                        </span>
                        <CarToken color={player.color} className="car-marker" />
                      </span>
                    )}
                    {space < 0 ? (
                      <small>GRID</small>
                    ) : space > game.track.finishSpace ? (
                      <small>{space}</small>
                    ) : (
                      space % 5 === 0 && <small>{space}</small>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
