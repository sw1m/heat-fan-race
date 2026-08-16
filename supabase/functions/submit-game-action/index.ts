// The browser submits commands here instead of asking Postgres to interpret
// movement, cards, Heat, or finish order. The function reconstructs the full
// state (including every player's private deck), runs the same deterministic
// reducer used by the local preview, then commits the result with a versioned
// database transaction.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.53.0';
import { applyGameAction } from '../../../src/engine/engine.ts';
import type {
  Card,
  GameAction,
  GameLogEntry,
  GameState,
  PlayerState,
  SubmittedPlan,
  TrackConfig,
} from '../../../src/engine/types.ts';

type JsonRecord = Record<string, unknown>;

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function jsonArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function cryptoRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function fallbackEngineCards(playerId: string, count: number): Card[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    id: `${playerId}-engine-${index}`,
    kind: 'HEAT' as const,
  }));
}

function submittedPlans(rows: JsonRecord[]): Record<string, SubmittedPlan> {
  return Object.fromEntries(
    rows.map((row) => [
      requiredString(row.room_player_id, 'Submitted player id'),
      {
        gear: Number(row.gear),
        cardIds: jsonArray<string>(row.card_ids),
        submittedAt: Date.parse(String(row.submitted_at ?? '')) || Date.now(),
      },
    ]),
  );
}

function stateFromRows(
  room: JsonRecord,
  roomPlayers: JsonRecord[],
  privateRows: JsonRecord[],
  submittedRows: JsonRecord[],
): GameState {
  const stored = jsonRecord(room.game_state);
  const positions = jsonRecord(stored.positions);
  const gears = jsonRecord(stored.gears);
  const finished = jsonRecord(stored.finished);
  const finishRanks = jsonRecord(stored.finishRanks);
  const finishProgress = jsonRecord(stored.finishProgress);
  const finishRounds = jsonRecord(stored.finishRounds);
  const privateByPlayer = new Map(privateRows.map((row) => [String(row.room_player_id), row]));
  const grid = jsonArray<{ space: number; lane: 0 | 1 }>(jsonRecord(stored.track).grid);

  const players: PlayerState[] = roomPlayers.map((row) => {
    const id = requiredString(row.id, 'Room player id');
    const privateState = privateByPlayer.get(id) ?? {};
    const storedPosition = jsonRecord(positions[id]);
    const engineCards = jsonArray<Card>(privateState.engine_cards);
    return {
      id,
      name: requiredString(row.nickname, 'Player nickname'),
      color: requiredString(row.color, 'Player color'),
      seat: Number(row.seat),
      gear: Number(gears[id] ?? 1),
      position: {
        space: Number(storedPosition.space ?? grid[Number(row.seat)]?.space ?? -2),
        lane: Number(
          storedPosition.lane ?? grid[Number(row.seat)]?.lane ?? Number(row.seat) % 2,
        ) as 0 | 1,
      },
      hand: jsonArray<Card>(privateState.hand),
      deck: jsonArray<Card>(privateState.draw_deck),
      discard: jsonArray<Card>(privateState.discard),
      engine: engineCards.length
        ? engineCards
        : fallbackEngineCards(id, Number(privateState.engine_heat ?? 0)),
      engineHeat: Number(privateState.engine_heat ?? 0),
      played: jsonArray<Card>(privateState.played),
      finished: Boolean(finished[id]),
      finishRank: finishRanks[id] == null ? null : Number(finishRanks[id]),
      finishProgress: finishProgress[id] == null ? null : Number(finishProgress[id]),
      finishRound: finishRounds[id] == null ? null : Number(finishRounds[id]),
      engineHeatCapacity: Number(jsonRecord(stored.track).engineHeatCapacity ?? 6) + 1,
      controller: 'HUMAN',
      disconnected: row.connected === false,
    };
  });

  const storedTrack = jsonRecord(stored.track) as unknown as TrackConfig;
  return {
    version: 1,
    phase: (stored.phase ?? 'LOBBY') as GameState['phase'],
    round: Number(stored.round ?? 1),
    startingPlayerCount: Number(stored.startingPlayerCount ?? players.length),
    stressReserve: Number(stored.stressReserve ?? 37 - players.length * 3),
    track: storedTrack,
    players,
    resolutionOrder: jsonArray<string>(stored.resolutionOrder),
    resolutionIndex: Number(stored.resolutionIndex ?? 0),
    activePlayerId: stored.activePlayerId == null ? null : String(stored.activePlayerId),
    submitted: submittedPlans(submittedRows),
    adrenalineEligibleIds: jsonArray<string>(stored.adrenalineEligibleIds),
    pending: (stored.pending as GameState['pending']) ?? null,
    nextCardId: Number(stored.nextCardId ?? 1),
    winnerId: stored.winnerId == null ? null : String(stored.winnerId),
    log: jsonArray<GameLogEntry>(stored.log),
  };
}

function publicStatePayload(state: GameState): JsonRecord {
  return {
    version: state.version,
    phase: state.phase,
    round: state.round,
    startingPlayerCount: state.startingPlayerCount,
    stressReserve: state.stressReserve,
    track: state.track,
    resolutionOrder: state.resolutionOrder,
    resolutionIndex: state.resolutionIndex,
    activePlayerId: state.activePlayerId,
    // This copy is server-private. get_room_snapshot replaces it with only
    // submitted/not-submitted booleans before returning data to browsers.
    submitted: state.submitted,
    adrenalineEligibleIds: state.adrenalineEligibleIds,
    pending: state.pending,
    nextCardId: state.nextCardId,
    winnerId: state.winnerId,
    log: state.log,
    positions: Object.fromEntries(state.players.map((player) => [player.id, player.position])),
    gears: Object.fromEntries(state.players.map((player) => [player.id, player.gear])),
    finished: Object.fromEntries(state.players.map((player) => [player.id, player.finished])),
    finishRanks: Object.fromEntries(state.players.map((player) => [player.id, player.finishRank])),
    finishProgress: Object.fromEntries(
      state.players.map((player) => [player.id, player.finishProgress]),
    ),
    finishRounds: Object.fromEntries(
      state.players.map((player) => [player.id, player.finishRound]),
    ),
  };
}

function privateStatePayload(state: GameState): JsonRecord[] {
  return state.players.map((player) => ({
    playerId: player.id,
    hand: player.hand,
    drawDeck: player.deck,
    discard: player.discard,
    engine: player.engine,
    played: player.played,
  }));
}

function actionType(action: GameAction): string {
  return action.type;
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function response(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

if (!supabaseUrl || !serviceRoleKey || !supabaseAnonKey) {
  console.error('Supabase function environment is incomplete.');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return response({ error: 'AUTH_REQUIRED' }, 401);
    }
    const accessToken = authorization.slice('Bearer '.length);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return response({ error: 'AUTH_REQUIRED' }, 401);
    }

    const body = jsonRecord(await request.json());
    const roomId = requiredString(body.roomId, 'roomId');
    const action = jsonRecord(body.action) as unknown as GameAction;
    const actionNonce = requiredString(body.actionNonce, 'actionNonce');
    if (!action.type || !action.playerId) {
      return response({ error: 'INVALID_ACTION' }, 400);
    }

    const [roomResult, playersResult, submittedResult] = await Promise.all([
      admin.from('rooms').select('id, version, game_state, status').eq('id', roomId).single(),
      admin.from('room_players').select('*').eq('room_id', roomId).order('seat'),
      admin.from('submitted_selections').select('*').eq('room_id', roomId),
    ]);
    if (roomResult.error) throw roomResult.error;
    if (playersResult.error) throw playersResult.error;
    if (submittedResult.error) throw submittedResult.error;
    const privateResult = await admin
      .from('player_private_state')
      .select('*')
      .in(
        'room_player_id',
        (playersResult.data ?? []).map((row) => row.id),
      );
    if (privateResult.error) throw privateResult.error;

    const currentState = stateFromRows(
      roomResult.data as JsonRecord,
      (playersResult.data ?? []) as JsonRecord[],
      (privateResult.data ?? []) as JsonRecord[],
      (submittedResult.data ?? []) as JsonRecord[],
    );
    const nextState = applyGameAction(currentState, action, cryptoRandom);
    const actor = nextState.players.find((player) => player.id === action.playerId);
    if (!actor) return response({ error: 'PLAYER_NOT_IN_RACE' }, 403);

    const { data, error } = await admin.rpc('commit_game_state', {
      p_room_id: roomId,
      p_expected_version: Number(roomResult.data.version),
      p_actor_identity: userData.user.id,
      p_action_nonce: actionNonce,
      p_action_type: actionType(action),
      p_public_payload: {
        actionNonce,
        actionType: actionType(action),
        playerId: action.playerId,
        phase: nextState.phase,
        round: nextState.round,
      },
      p_game_state: publicStatePayload(nextState),
      p_private_states: privateStatePayload(nextState),
    });
    if (error) {
      const conflict = error.message.includes('STALE_ROOM_VERSION');
      return response({ error: error.message }, conflict ? 409 : 400);
    }
    return response(data as JsonRecord);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AUTHORITATIVE_ACTION_FAILED';
    return response({ error: message }, 400);
  }
});
