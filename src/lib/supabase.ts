import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PlayerColor } from '../engine/constants';
import type { GameAction, GameState } from '../engine/types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('your-project'));
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null;

export interface RoomPlayer {
  id: string;
  nickname: string;
  seat: number;
  color: string;
  isHost: boolean;
  connected: boolean;
  submitted: boolean;
  position?: { space: number; lane: 0 | 1 };
  gear?: number;
  engineHeat?: number;
  handCount?: number;
  deckCount?: number;
  discardCount?: number;
  finished?: boolean;
  finishRank?: number | null;
  isBot?: boolean;
}

export interface RemoteRoom {
  id: string;
  code: string;
  hostPlayerId: string;
  status: 'LOBBY' | 'RACING' | 'FINISHED';
  players: RoomPlayer[];
  game: GameState | null;
  privateHand: GameState['players'][number]['hand'];
  reconnectToken: string;
}

type RpcResult = Record<string, unknown>;

function asRecord(value: unknown): RpcResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as RpcResult;
}

function asRemoteRoom(value: unknown): RemoteRoom {
  const record = asRecord(value);
  return record as unknown as RemoteRoom;
}

async function callRpc(name: string, args: Record<string, unknown>): Promise<RemoteRoom> {
  if (!supabase) throw new Error('Realtime backend is not configured.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return asRemoteRoom(data);
}

export async function ensureAnonymousIdentity(): Promise<{ userId: string; sessionToken: string }> {
  if (!supabase) {
    const existing = localStorage.getItem('heat-fan-identity');
    if (existing) return JSON.parse(existing) as { userId: string; sessionToken: string };
    const identity = { userId: crypto.randomUUID(), sessionToken: crypto.randomUUID() };
    localStorage.setItem('heat-fan-identity', JSON.stringify(identity));
    return identity;
  }
  const current = await supabase.auth.getSession();
  if (current.data.session)
    return {
      userId: current.data.session.user.id,
      sessionToken: current.data.session.access_token,
    };
  const result = await supabase.auth.signInAnonymously();
  if (result.error || !result.data.session)
    throw new Error(result.error?.message ?? 'Anonymous sign-in failed.');
  return { userId: result.data.session.user.id, sessionToken: result.data.session.access_token };
}

export async function createRemoteRoom(nickname: string, color: PlayerColor): Promise<RemoteRoom> {
  const identity = await ensureAnonymousIdentity();
  return callRpc('create_race_room', {
    p_nickname: nickname,
    p_color: color,
    p_client_identity: identity.userId,
  });
}

export async function joinRemoteRoom(
  code: string,
  nickname: string,
  color: PlayerColor,
  reconnectToken?: string,
): Promise<RemoteRoom> {
  const identity = await ensureAnonymousIdentity();
  return callRpc('join_race_room', {
    p_room_code: code,
    p_nickname: nickname,
    p_color: color,
    p_client_identity: identity.userId,
    p_reconnect_token: reconnectToken ?? null,
  });
}

export async function startRemoteRoom(roomId: string): Promise<RemoteRoom> {
  return callRpc('start_race', { p_room_id: roomId });
}

export async function restartRemoteRoom(roomId: string): Promise<RemoteRoom> {
  return callRpc('start_race', { p_room_id: roomId });
}

export async function sendRemoteAction(roomId: string, action: GameAction): Promise<RemoteRoom> {
  return callRpc('submit_game_action', { p_room_id: roomId, p_action: action });
}

export async function loadRemoteRoom(roomId: string): Promise<RemoteRoom> {
  return callRpc('get_room_snapshot', { p_room_id: roomId });
}

export async function leaveRemoteRoom(roomId: string): Promise<void> {
  if (!supabase) throw new Error('Realtime backend is not configured.');
  const { error } = await supabase.rpc('leave_room', { p_room_id: roomId });
  if (error) throw new Error(error.message);
}

export function subscribeToRoom(roomId: string, onChange: () => void): () => void {
  if (!supabase) return () => undefined;
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
