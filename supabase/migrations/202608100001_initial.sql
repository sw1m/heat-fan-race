-- Heat Fan Race V1: private rooms, anonymous seats, server-owned commands.
-- Apply with `supabase db push` or the SQL editor. The browser never receives service-role access.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_identity uuid not null,
  status text not null default 'LOBBY' check (status in ('LOBBY', 'RACING', 'FINISHED')),
  game_state jsonb not null default jsonb_build_object('version', 1, 'phase', 'LOBBY'),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  client_identity uuid not null,
  reconnect_token uuid not null default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  seat smallint not null check (seat between 0 and 3),
  color text not null,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  unique(room_id, seat),
  unique(room_id, client_identity)
);

create table if not exists public.player_private_state (
  room_player_id uuid primary key references public.room_players(id) on delete cascade,
  hand jsonb not null default '[]'::jsonb,
  draw_deck jsonb not null default '[]'::jsonb,
  discard jsonb not null default '[]'::jsonb,
  engine_heat smallint not null default 6 check (engine_heat between 0 and 6),
  played jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.submitted_selections (
  room_id uuid not null references public.rooms(id) on delete cascade,
  room_player_id uuid not null references public.room_players(id) on delete cascade,
  gear smallint not null check (gear between 1 and 4),
  card_ids jsonb not null,
  action_nonce uuid not null,
  submitted_at timestamptz not null default now(),
  primary key (room_id, room_player_id),
  unique(room_id, action_nonce)
);

create table if not exists public.finish_results (
  room_id uuid not null references public.rooms(id) on delete cascade,
  room_player_id uuid not null references public.room_players(id) on delete cascade,
  finish_rank smallint not null,
  finished_round smallint not null,
  final_space smallint not null,
  final_lane smallint not null,
  primary key(room_id, room_player_id),
  unique(room_id, finish_rank)
);

create table if not exists public.room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  version bigint not null,
  kind text not null,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists room_players_room_idx on public.room_players(room_id);
create index if not exists room_players_identity_idx on public.room_players(client_identity);
create index if not exists room_events_room_version_idx on public.room_events(room_id, version desc);
create index if not exists rooms_status_updated_idx on public.rooms(status, updated_at desc);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.player_private_state enable row level security;
alter table public.submitted_selections enable row level security;
alter table public.finish_results enable row level security;
alter table public.room_events enable row level security;

create or replace function public.is_room_member(p_room_id uuid) returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (select 1 from public.room_players where room_id = p_room_id and client_identity = auth.uid());
$$;

create or replace function public.is_own_room_player(p_room_player_id uuid) returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (select 1 from public.room_players where id = p_room_player_id and client_identity = auth.uid());
$$;

-- Do not grant direct room reads: game_state is server-private and includes hidden decks.
create policy room_players_can_read_members on public.room_players for select using (public.is_room_member(room_id));
create policy own_private_state_only on public.player_private_state for select using (public.is_own_room_player(room_player_id));
create policy room_members_can_read_events on public.room_events for select using (public.is_room_member(room_id));
create policy room_members_can_read_finish_results on public.finish_results for select using (public.is_room_member(room_id));

create or replace function public.make_room_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(encode(gen_random_bytes(5), 'base64'), 1, 6));
    candidate := regexp_replace(candidate, '[^A-Z0-9]', 'A', 'g');
    exit when not exists (select 1 from public.rooms where code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.unique_room_nickname(p_room_id uuid, p_nickname text) returns text
language plpgsql security definer set search_path = public as $$
declare
  candidate text := left(trim(p_nickname), 20);
  suffix integer := 2;
begin
  if not exists (select 1 from public.room_players where room_id = p_room_id and lower(nickname) = lower(candidate)) then return candidate; end if;
  loop
    exit when not exists (select 1 from public.room_players where room_id = p_room_id and lower(nickname) = lower(candidate || ' #' || suffix));
    suffix := suffix + 1;
  end loop;
  return left(candidate || ' #' || suffix, 24);
end;
$$;

create or replace function public.beginner_deck(p_player_id uuid) returns jsonb
language sql as $$
  select jsonb_agg(card order by random()) from (
    select jsonb_build_object('id', p_player_id::text || '-basic-' || v::text || '-' || c::text, 'kind', 'BASIC', 'value', v) as card
    from generate_series(1, 4) v cross join generate_series(0, 2) c
    union all select jsonb_build_object('id', p_player_id::text || '-stress-' || c::text, 'kind', 'STRESS') from generate_series(0, 2) c
    union all select jsonb_build_object('id', p_player_id::text || '-upgrade-zero', 'kind', 'STARTING_ZERO', 'value', 0)
    union all select jsonb_build_object('id', p_player_id::text || '-upgrade-five', 'kind', 'STARTING_FIVE', 'value', 5)
    union all select jsonb_build_object('id', p_player_id::text || '-upgrade-heat', 'kind', 'STARTING_HEAT')
  ) cards;
$$;

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
    'isHost', rp.client_identity = r.host_identity, 'connected', rp.connected,
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
  return jsonb_build_object('id', r.id, 'code', r.code, 'hostPlayerId', (select id from public.room_players where room_id = p_room_id and client_identity = r.host_identity), 'status', r.status, 'players', public_players, 'game', game, 'privateHand', coalesce((select ps.hand from public.player_private_state ps where ps.room_player_id = me.id), '[]'::jsonb), 'reconnectToken', me.reconnect_token);
end;
$$;

create or replace function public.create_race_room(p_nickname text, p_client_identity uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare room_id uuid; host_id uuid; code text;
begin
  if auth.uid() is null then raise exception 'ANONYMOUS_AUTH_REQUIRED'; end if;
  host_id := auth.uid(); code := public.make_room_code();
  insert into public.rooms(code, host_identity) values (code, host_id) returning id into room_id;
  insert into public.room_players(room_id, client_identity, nickname, seat, color) values (room_id, host_id, public.unique_room_nickname(room_id, p_nickname), 0, '#d44735') returning id into host_id;
  return public.get_room_snapshot(room_id);
end;
$$;

create or replace function public.join_race_room(p_room_code text, p_nickname text, p_client_identity uuid default null, p_reconnect_token uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; existing public.room_players; next_seat integer;
begin
  if auth.uid() is null then raise exception 'ANONYMOUS_AUTH_REQUIRED'; end if;
  select * into r from public.rooms where code = upper(trim(p_room_code)) for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into existing from public.room_players where room_id = r.id and client_identity = auth.uid();
  if existing.id is not null and (p_reconnect_token is null or p_reconnect_token = existing.reconnect_token) then update public.room_players set connected = true where id = existing.id; return public.get_room_snapshot(r.id); end if;
  if r.status <> 'LOBBY' then raise exception 'ROOM_ALREADY_RACING'; end if;
  select coalesce(min(candidate.seat), 4) into next_seat from generate_series(0, 3) as candidate(seat) where not exists(select 1 from public.room_players where room_id = r.id and room_players.seat = candidate.seat);
  if next_seat >= 4 then raise exception 'ROOM_FULL'; end if;
  insert into public.room_players(room_id, client_identity, nickname, seat, color) values (r.id, auth.uid(), public.unique_room_nickname(r.id, p_nickname), next_seat, (array['#d44735','#ee9a2f','#245c8c','#2f7a54'])[next_seat + 1]);
  return public.get_room_snapshot(r.id);
end;
$$;

create or replace function public.leave_room(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  r public.rooms;
  me public.room_players;
  next_identity uuid;
  remaining integer;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from public.room_players where room_id = p_room_id and client_identity = auth.uid() for update;
  if me.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;

  if r.status = 'LOBBY' then
    delete from public.room_players where id = me.id;
    select count(*) into remaining from public.room_players where room_id = p_room_id;
    if remaining = 0 then
      delete from public.rooms where id = p_room_id;
      return jsonb_build_object('left', true, 'roomDeleted', true);
    end if;
  else
    update public.room_players set connected = false where id = me.id;
  end if;

  if r.host_identity = me.client_identity then
    select client_identity into next_identity
    from public.room_players
    where room_id = p_room_id and (r.status = 'LOBBY' or connected)
    order by seat
    limit 1;
    if next_identity is not null then
      update public.rooms set host_identity = next_identity where id = p_room_id;
    end if;
  end if;

  update public.rooms
  set version = version + 1, updated_at = now()
  where id = p_room_id;
  insert into public.room_events(room_id, version, kind, public_payload)
  select p_room_id, version, 'PLAYER_LEFT', jsonb_build_object('playerId', me.id, 'status', r.status)
  from public.rooms where id = p_room_id;
  return jsonb_build_object('left', true, 'roomId', p_room_id, 'status', r.status);
end;
$$;

create or replace function public.start_race(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; rp record; deck jsonb; hand jsonb; draw_deck jsonb; player_count integer;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists(select 1 from public.room_players where room_id = p_room_id and client_identity = auth.uid() and id = (select id from public.room_players where room_id = p_room_id and client_identity = r.host_identity)) then raise exception 'HOST_ONLY'; end if;
  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if player_count < 2 then raise exception 'TWO_PLAYERS_REQUIRED'; end if;
  if r.status = 'RACING' then raise exception 'RACE_ALREADY_STARTED'; end if;
  delete from public.player_private_state where room_player_id in (select id from public.room_players where room_id = p_room_id);
  for rp in select * from public.room_players where room_id = p_room_id order by seat loop
    deck := public.beginner_deck(rp.id);
    select coalesce(jsonb_agg(value), '[]'::jsonb) into hand from jsonb_array_elements(deck) with ordinality x(value, ordinality) where ordinality <= 7;
    select coalesce(jsonb_agg(value), '[]'::jsonb) into draw_deck from jsonb_array_elements(deck) with ordinality x(value, ordinality) where ordinality > 7;
    insert into public.player_private_state(room_player_id, hand, draw_deck, engine_heat) values (rp.id, hand, draw_deck, 6);
  end loop;
  update public.rooms set status = 'RACING', version = version + 1, game_state = jsonb_build_object('version', 1, 'phase', 'PLANNING', 'round', 1, 'resolutionOrder', '[]'::jsonb, 'activePlayerId', null, 'pending', null, 'submitted', '{}'::jsonb, 'track', jsonb_build_object('id', 'usa-beginner-starter', 'name', 'USA - one-lap learning race', 'laps', 1, 'finishSpace', 40, 'corners', jsonb_build_array(jsonb_build_object('id', 'corner-1', 'lineSpace', 10, 'speedLimit', 4, 'label', 'Turn 1'), jsonb_build_object('id', 'corner-2', 'lineSpace', 20, 'speedLimit', 3, 'label', 'Turn 2'), jsonb_build_object('id', 'corner-3', 'lineSpace', 29, 'speedLimit', 5, 'label', 'Turn 3'), jsonb_build_object('id', 'corner-4', 'lineSpace', 36, 'speedLimit', 4, 'label', 'Turn 4')), 'grid', jsonb_build_array(jsonb_build_object('space', 0, 'lane', 0), jsonb_build_object('space', 0, 'lane', 1), jsonb_build_object('space', -1, 'lane', 0), jsonb_build_object('space', -1, 'lane', 1))), 'positions', (select jsonb_object_agg(id::text, jsonb_build_object('space', case when seat < 2 then 0 else -1 end, 'lane', seat % 2)) from public.room_players where room_id = p_room_id), 'gears', (select jsonb_object_agg(id::text, 1) from public.room_players where room_id = p_room_id), 'finished', '{}'::jsonb, 'finishRanks', '{}'::jsonb), updated_at = now() where id = p_room_id;
  insert into public.room_events(room_id, version, kind, public_payload) select p_room_id, version, 'RACE_STARTED', jsonb_build_object('phase', 'PLANNING', 'round', 1) from public.rooms where id = p_room_id;
  return public.get_room_snapshot(p_room_id);
end;
$$;

-- Every state change is transactional and row-locked. Card ownership is checked in SQL before the
-- action is recorded. The TypeScript engine is the readable reference implementation; this RPC is
-- intentionally the only write boundary and is extended as new modules are added.
create or replace function public.submit_game_action(p_room_id uuid, p_action jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms; rp public.room_players; ps public.player_private_state; action_type text; card_ids jsonb; gear integer; owned integer; delta integer; nonce uuid;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into rp from public.room_players where room_id = p_room_id and client_identity = auth.uid() for update;
  if rp.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;
  action_type := p_action->>'type'; nonce := coalesce((p_action->>'actionNonce')::uuid, gen_random_uuid());
  if exists(select 1 from public.room_events where room_id = p_room_id and public_payload->>'actionNonce' = nonce::text) then raise exception 'DUPLICATE_ACTION'; end if;
  if action_type = 'SUBMIT_PLAN' then
    if r.game_state->>'phase' <> 'PLANNING' then raise exception 'PLANS_CLOSED'; end if;
    if exists(select 1 from public.submitted_selections where room_id = p_room_id and room_player_id = rp.id) then raise exception 'DUPLICATE_SUBMISSION'; end if;
    gear := (p_action->>'gear')::integer; card_ids := p_action->'cardIds';
    if gear not between 1 and 4 or jsonb_array_length(card_ids) <> gear then raise exception 'INVALID_CARD_COUNT'; end if;
    select count(*) into owned from jsonb_array_elements_text(card_ids) wanted where exists(select 1 from jsonb_array_elements((select hand from public.player_private_state where room_player_id = rp.id)) held where held->>'id' = wanted);
    if owned <> jsonb_array_length(card_ids) then raise exception 'CARD_NOT_IN_HAND'; end if;
    select * into ps from public.player_private_state where room_player_id = rp.id for update;
    delta := abs(gear - coalesce((r.game_state #>> array['gears', rp.id::text])::integer, 1));
    if delta > 1 and delta <> 2 then raise exception 'INVALID_SHIFT'; end if;
    if delta = 2 and ps.engine_heat < 1 then raise exception 'SHIFT_NEEDS_HEAT'; end if;
    if delta = 2 then update public.player_private_state set engine_heat = engine_heat - 1, discard = discard || jsonb_build_array(jsonb_build_object('id', rp.id::text || '-paid-shift-' || r.version::text, 'kind', 'HEAT')) where room_player_id = rp.id; end if;
    insert into public.submitted_selections(room_id, room_player_id, gear, card_ids, action_nonce) values (p_room_id, rp.id, gear, card_ids, nonce);
    update public.rooms set version = version + 1, game_state = jsonb_set(jsonb_set(game_state, array['gears', rp.id::text], to_jsonb(gear), true), '{phase}', '"PLANNING"'::jsonb), updated_at = now() where id = p_room_id returning * into r;
  elsif action_type in ('PASS_REACTION', 'BOOST', 'COOLDOWN', 'SLIPSTREAM', 'ADRENALINE_SPEED', 'ADRENALINE_COOLDOWN') then
    if r.game_state->>'phase' not in ('PLAYER_REACTION', 'RESOLVING_PLAYER') then raise exception 'REACTION_CLOSED'; end if;
    if (r.game_state->>'activePlayerId') <> rp.id::text then raise exception 'NOT_ACTIVE_PLAYER'; end if;
    insert into public.room_events(room_id, version, kind, public_payload) values (p_room_id, r.version + 1, action_type, p_action || jsonb_build_object('actionNonce', nonce));
    update public.rooms set version = version + 1, updated_at = now() where id = p_room_id returning * into r;
  else
    raise exception 'UNKNOWN_ACTION';
  end if;
  insert into public.room_events(room_id, version, kind, public_payload) values (p_room_id, r.version, action_type, jsonb_build_object('actionNonce', nonce, 'playerId', rp.id));
  return public.get_room_snapshot(p_room_id);
end;
$$;

grant usage on schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.room_events;
