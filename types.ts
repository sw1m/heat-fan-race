export type Phase =
  | 'LOBBY'
  | 'DEALING'
  | 'PLANNING'
  | 'WAITING_FOR_PLAYERS'
  | 'RESOLVING_PLAYER'
  | 'PLAYER_REACTION'
  | 'ROUND_CLEANUP'
  | 'FINISHED';

export type CardKind =
  'BASIC' | 'STRESS' | 'HEAT' | 'STARTING_ZERO' | 'STARTING_FIVE' | 'STARTING_HEAT';
export type Lane = 0 | 1;

export interface Card {
  id: string;
  kind: CardKind;
  value?: number;
}

export interface TrackCorner {
  id: string;
  lineSpace: number;
  speedLimit: number;
  label: string;
}

export interface TrackConfig {
  id: string;
  name: string;
  laps: number;
  finishSpace: number;
  corners: TrackCorner[];
  grid: Array<{ space: number; lane: Lane }>;
}

export interface CarPosition {
  space: number;
  lane: Lane;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  seat: number;
  gear: number;
  position: CarPosition;
  hand: Card[];
  deck: Card[];
  discard: Card[];
  engine: Card[];
  played: Card[];
  finished: boolean;
  finishRank: number | null;
  disconnected?: boolean;
}

export interface SubmittedPlan {
  gear: number;
  cardIds: string[];
  submittedAt: number;
}

export type ReactionKind = 'ADRENALINE' | 'GEAR_REACTION' | 'SLIPSTREAM' | 'CORNER_PAYMENT';

export interface PendingReaction {
  kind: ReactionKind;
  playerId: string;
  options: string[];
  speed: number;
  startSpace: number;
  movedSpace: number;
  adrenalineSpeedAvailable: boolean;
  adrenalineCooldownAvailable: boolean;
  boostAvailable: boolean;
  cooldownAvailable: number;
  slipstreamAvailable: boolean;
  crossedCornerIds: string[];
}

export interface GameLogEntry {
  id: string;
  round: number;
  text: string;
  playerId?: string;
}

export interface GameState {
  version: 1;
  phase: Phase;
  round: number;
  track: TrackConfig;
  players: PlayerState[];
  resolutionOrder: string[];
  resolutionIndex: number;
  activePlayerId: string | null;
  submitted: Record<string, SubmittedPlan>;
  adrenalineEligibleIds: string[];
  pending: PendingReaction | null;
  nextCardId: number;
  winnerId: string | null;
  log: GameLogEntry[];
}

export type RandomSource = () => number;

export type GameAction =
  | { type: 'SUBMIT_PLAN'; playerId: string; gear: number; cardIds: string[] }
  | { type: 'ADRENALINE_SPEED'; playerId: string }
  | { type: 'ADRENALINE_COOLDOWN'; playerId: string }
  | { type: 'BOOST'; playerId: string }
  | { type: 'COOLDOWN'; playerId: string }
  | { type: 'SLIPSTREAM'; playerId: string }
  | { type: 'PASS_REACTION'; playerId: string };
