-- Allow the host to remove a non-host seat before the race starts.
-- The room row is locked so removal, seat release, and the realtime event are atomic.

create or replace function public.get_room_snapshot(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.room_players;
  public_players jsonb;
  game jsonb;
begin
  select * into r from public.rooms where id = p_room_id for share;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from public.room_players where room_id = p_room_id and client_identity = auth.uid();
  if me.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rp.id, 'nickname', rp.nickname, 'seat', rp.seat, 'color', rp.color,
    'isHost', rp.client_identity = r.host_identity, 'isMe', rp.id = me.id, 'connected', rp.connected,
    'submitted', exists(select 1 from public.submitted_selections ss where ss.room_id = p_room_id and ss.room_player_id = rp.id),
    'position', coalesce(r.game_state #> array['positions', rp.id::text], jsonb_build_object('space', 0, 'lane', rp.seat % 2)),
    'gear', coalesce((r.game_state #>> array['gears', rp.id::text])::int, 1),
    'engineHeat', coalesce((select ps.engine_heat from public.player_private_state ps where ps.room_player_id = rp.id), 6),
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

create or replace function public.remove_lobby_player(
  p_room_id uuid,
  p_room_player_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  r public.rooms;
  me public.room_players;
  target public.room_players;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from public.room_players
    where room_id = p_room_id and client_identity = auth.uid()
    for update;
  if me.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;
  if r.status <> 'LOBBY' then raise exception 'ROOM_NOT_LOBBY'; end if;
  if r.host_identity <> me.client_identity then raise exception 'HOST_ONLY'; end if;

  select * into target from public.room_players
    where room_id = p_room_id and id = p_room_player_id
    for update;
  if target.id is null then raise exception 'PLAYER_NOT_FOUND'; end if;
  if target.id = me.id or target.client_identity = r.host_identity then
    raise exception 'CANNOT_REMOVE_HOST';
  end if;

  delete from public.room_players where id = target.id;
  update public.rooms set version = version + 1, updated_at = now() where id = p_room_id;
  insert into public.room_events(room_id, version, kind, public_payload)
    select p_room_id, version, 'PLAYER_REMOVED', jsonb_build_object(
      'playerId', target.id,
      'seat', target.seat
    )
    from public.rooms where id = p_room_id;
  return public.get_room_snapshot(p_room_id);
end;
$$;

grant execute on function public.remove_lobby_player(uuid, uuid) to authenticated;
