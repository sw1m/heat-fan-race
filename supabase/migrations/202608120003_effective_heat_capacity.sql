-- The USA board supplies six base engine slots. Each beginner deck also has
-- one special Starting Heat card, which adds a seventh usable engine slot.
-- Keep the database projection and storage constraint aligned with the engine.

alter table public.player_private_state
  drop constraint if exists player_private_state_engine_heat_check;

alter table public.player_private_state
  add constraint player_private_state_engine_heat_check check (engine_heat between 0 and 7);

create or replace function public.get_room_snapshot(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.room_players;
  public_players jsonb;
  game jsonb;
  effective_capacity integer;
begin
  select * into r from public.rooms where id = p_room_id for share;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from public.room_players where room_id = p_room_id and client_identity = auth.uid();
  if me.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;
  effective_capacity := coalesce((r.game_state #>> array['track','engineHeatCapacity'])::int, 6) + 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rp.id, 'nickname', rp.nickname, 'seat', rp.seat, 'color', rp.color,
    'isHost', rp.client_identity = r.host_identity, 'isMe', rp.id = me.id, 'connected', rp.connected,
    'submitted', exists(select 1 from public.submitted_selections ss where ss.room_id = p_room_id and ss.room_player_id = rp.id),
    'position', coalesce(r.game_state #> array['positions', rp.id::text], jsonb_build_object('space', 0, 'lane', rp.seat % 2)),
    'gear', coalesce((r.game_state #>> array['gears', rp.id::text])::int, 1),
    'engineHeat', coalesce((select ps.engine_heat from public.player_private_state ps where ps.room_player_id = rp.id), 6),
    'engineHeatCapacity', effective_capacity,
    'handCount', coalesce((select jsonb_array_length(ps.hand) from public.player_private_state ps where ps.room_player_id = rp.id), 0),
    'deckCount', coalesce((select jsonb_array_length(ps.draw_deck) from public.player_private_state ps where ps.room_player_id = rp.id), 0),
    'discardCount', coalesce((select jsonb_array_length(ps.discard) from public.player_private_state ps where ps.room_player_id = rp.id), 0),
    'finished', coalesce((r.game_state #>> array['finished', rp.id::text])::boolean, false),
    'finishRank', (r.game_state #>> array['finishRanks', rp.id::text])::int
  ) order by rp.seat), '[]'::jsonb) into public_players
  from public.room_players rp where rp.room_id = p_room_id;

  game := r.game_state || jsonb_build_object(
    'players', coalesce((select jsonb_agg(
      jsonb_build_object(
        'id', rp.id, 'name', rp.nickname, 'color', rp.color, 'seat', rp.seat,
        'gear', coalesce((r.game_state #>> array['gears', rp.id::text])::int, 1),
        'engineHeatCapacity', effective_capacity,
        'position', coalesce(r.game_state #> array['positions', rp.id::text], jsonb_build_object('space', 0, 'lane', rp.seat % 2)),
        'hand', case when rp.id = me.id then coalesce(ps.hand, '[]'::jsonb) else '[]'::jsonb end,
        'deck', case when rp.id = me.id then coalesce(ps.draw_deck, '[]'::jsonb) else '[]'::jsonb end,
        'discard', case when rp.id = me.id then coalesce(ps.discard, '[]'::jsonb) else '[]'::jsonb end,
        'engine', case when rp.id = me.id then (select coalesce(jsonb_agg(jsonb_build_object('id', rp.id::text || '-engine-' || n::text, 'kind', 'HEAT')), '[]'::jsonb) from generate_series(1, coalesce(ps.engine_heat, 0)) n) else '[]'::jsonb end,
        'played', case when rp.id = me.id then coalesce(ps.played, '[]'::jsonb) else '[]'::jsonb end,
        'finished', coalesce((r.game_state #>> array['finished', rp.id::text])::boolean, false),
        'finishRank', (r.game_state #>> array['finishRanks', rp.id::text])::int
      ) order by rp.seat
    ) from public.room_players rp left join public.player_private_state ps on ps.room_player_id = rp.id where rp.room_id = p_room_id), '[]'::jsonb),
    'privateHand', coalesce((select ps.hand from public.player_private_state ps where ps.room_player_id = me.id), '[]'::jsonb)
  );
  return jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'hostPlayerId', (select id from public.room_players where room_id = p_room_id and client_identity = r.host_identity),
    'status', r.status,
    'players', public_players,
    'game', game,
    'privateHand', coalesce((select ps.hand from public.player_private_state ps where ps.room_player_id = me.id), '[]'::jsonb),
    'reconnectToken', me.reconnect_token
  );
end;
$$;
