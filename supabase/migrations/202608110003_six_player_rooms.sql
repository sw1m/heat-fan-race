-- Expand the room and starting-grid boundaries to the base game's six-player limit.
-- Existing rooms keep their current seats and colors; new joins use the six-seat policy.

alter table public.room_players drop constraint if exists room_players_seat_check;
alter table public.room_players
  add constraint room_players_seat_check check (seat between 0 and 5);

create or replace function public.is_allowed_player_color(p_color text) returns boolean
language sql immutable as $$
  select lower(trim(p_color)) = any(
    array[
      '#d44735',
      '#f2c230',
      '#245c8c',
      '#2f7a54',
      '#7b4d9e',
      '#2b9db2'
    ]::text[]
  );
$$;

create or replace function public.create_race_room(
  p_nickname text,
  p_client_identity uuid default null,
  p_color text default '#d44735'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  room_id uuid;
  host_id uuid;
  code text;
  chosen_color text := lower(trim(p_color));
begin
  if auth.uid() is null then raise exception 'ANONYMOUS_AUTH_REQUIRED'; end if;
  if not public.is_allowed_player_color(chosen_color) then raise exception 'INVALID_PLAYER_COLOR'; end if;
  host_id := auth.uid();
  code := public.make_room_code();
  insert into public.rooms(code, host_identity) values (code, host_id) returning id into room_id;
  insert into public.room_players(room_id, client_identity, nickname, seat, color)
    values (room_id, host_id, public.unique_room_nickname(room_id, p_nickname), 0, chosen_color);
  return public.get_room_snapshot(room_id);
end;
$$;

create or replace function public.join_race_room(
  p_room_code text,
  p_nickname text,
  p_client_identity uuid default null,
  p_reconnect_token uuid default null,
  p_color text default '#d44735'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  existing public.room_players;
  next_seat integer;
  chosen_color text := lower(trim(p_color));
begin
  if auth.uid() is null then raise exception 'ANONYMOUS_AUTH_REQUIRED'; end if;
  if not public.is_allowed_player_color(chosen_color) then raise exception 'INVALID_PLAYER_COLOR'; end if;
  select * into r from public.rooms where code = upper(trim(p_room_code)) for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into existing from public.room_players
    where room_id = r.id and client_identity = auth.uid();
  if existing.id is not null and (p_reconnect_token is null or p_reconnect_token = existing.reconnect_token) then
    update public.room_players set connected = true where id = existing.id;
    return public.get_room_snapshot(r.id);
  end if;
  if r.status <> 'LOBBY' then raise exception 'ROOM_ALREADY_RACING'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and color = chosen_color) then
    raise exception 'COLOR_TAKEN';
  end if;
  select coalesce(min(candidate.seat), 6) into next_seat
    from generate_series(0, 5) as candidate(seat)
    where not exists (
      select 1 from public.room_players
      where room_id = r.id and room_players.seat = candidate.seat
    );
  if next_seat >= 6 then raise exception 'ROOM_FULL'; end if;
  insert into public.room_players(room_id, client_identity, nickname, seat, color)
    values (r.id, auth.uid(), public.unique_room_nickname(r.id, p_nickname), next_seat, chosen_color);
  return public.get_room_snapshot(r.id);
end;
$$;

create or replace function public.start_race(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  rp record;
  deck jsonb;
  hand jsonb;
  draw_deck jsonb;
  track_config jsonb;
  player_count integer;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists(
    select 1 from public.room_players
    where room_id = p_room_id
      and client_identity = auth.uid()
      and id = (select id from public.room_players where room_id = p_room_id and client_identity = r.host_identity)
  ) then raise exception 'HOST_ONLY'; end if;
  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if player_count < 2 then raise exception 'TWO_PLAYERS_REQUIRED'; end if;
  if player_count > 6 then raise exception 'SIX_PLAYERS_MAXIMUM'; end if;
  if r.status = 'RACING' then raise exception 'RACE_ALREADY_STARTED'; end if;

  delete from public.player_private_state
    where room_player_id in (select id from public.room_players where room_id = p_room_id);
  delete from public.submitted_selections where room_id = p_room_id;
  delete from public.finish_results where room_id = p_room_id;

  for rp in select * from public.room_players where room_id = p_room_id order by seat loop
    deck := public.beginner_deck(rp.id);
    select coalesce(jsonb_agg(value), '[]'::jsonb) into hand
      from jsonb_array_elements(deck) with ordinality x(value, ordinality)
      where ordinality <= 7;
    select coalesce(jsonb_agg(value), '[]'::jsonb) into draw_deck
      from jsonb_array_elements(deck) with ordinality x(value, ordinality)
      where ordinality > 7;
    insert into public.player_private_state(room_player_id, hand, draw_deck, engine_heat)
      values (rp.id, hand, draw_deck, 6);
  end loop;

  track_config := jsonb_build_object(
    'id', 'usa-beginner-starter',
    'name', 'USA - one-lap learning race',
    'laps', 1,
    'finishSpace', 40,
    'corners', jsonb_build_array(
      jsonb_build_object('id', 'corner-1', 'lineSpace', 10, 'speedLimit', 4, 'label', 'Turn 1'),
      jsonb_build_object('id', 'corner-2', 'lineSpace', 20, 'speedLimit', 3, 'label', 'Turn 2'),
      jsonb_build_object('id', 'corner-3', 'lineSpace', 29, 'speedLimit', 5, 'label', 'Turn 3'),
      jsonb_build_object('id', 'corner-4', 'lineSpace', 36, 'speedLimit', 4, 'label', 'Turn 4')
    ),
    'grid', jsonb_build_array(
      jsonb_build_object('space', 0, 'lane', 0),
      jsonb_build_object('space', 0, 'lane', 1),
      jsonb_build_object('space', -1, 'lane', 0),
      jsonb_build_object('space', -1, 'lane', 1),
      jsonb_build_object('space', -2, 'lane', 0),
      jsonb_build_object('space', -2, 'lane', 1)
    )
  );

  update public.rooms
  set status = 'RACING',
      version = version + 1,
      game_state = jsonb_build_object(
        'version', 1,
        'phase', 'PLANNING',
        'round', 1,
        'resolutionOrder', '[]'::jsonb,
        'activePlayerId', null,
        'pending', null,
        'submitted', '{}'::jsonb,
        'track', track_config,
        'positions', (
          select jsonb_object_agg(
            id::text,
            jsonb_build_object(
              'space', case when seat < 2 then 0 when seat < 4 then -1 else -2 end,
              'lane', seat % 2
            )
          )
          from public.room_players where room_id = p_room_id
        ),
        'gears', (select jsonb_object_agg(id::text, 1) from public.room_players where room_id = p_room_id),
        'finished', '{}'::jsonb,
        'finishRanks', '{}'::jsonb
      ),
      updated_at = now()
  where id = p_room_id;

  insert into public.room_events(room_id, version, kind, public_payload)
    select p_room_id, version, 'RACE_STARTED', jsonb_build_object('phase', 'PLANNING', 'round', 1)
    from public.rooms where id = p_room_id;
  return public.get_room_snapshot(p_room_id);
end;
$$;

grant execute on function public.is_allowed_player_color(text) to authenticated;
grant execute on function public.create_race_room(text, uuid, text) to authenticated;
grant execute on function public.join_race_room(text, text, uuid, uuid, text) to authenticated;
grant execute on function public.start_race(uuid) to authenticated;
