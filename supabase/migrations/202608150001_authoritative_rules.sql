-- Align the shared Supabase race with the same rule reducer used by the local
-- preview. The browser may request an action, but only the server-side Edge
-- Function can commit a reducer result through commit_game_state.

alter table public.player_private_state
  add column if not exists engine_cards jsonb not null default '[]'::jsonb;

create or replace function public.build_room_snapshot(
  p_room_id uuid,
  p_requester uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r public.rooms;
  me public.room_players;
  public_players jsonb;
  public_submitted jsonb;
  game jsonb;
  effective_capacity integer;
begin
  select * into r from public.rooms where id = p_room_id for share;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me
  from public.room_players
  where room_id = p_room_id and client_identity = p_requester;
  if me.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;

  effective_capacity := coalesce((r.game_state #>> array['track','engineHeatCapacity'])::int, 6) + 1;

  select coalesce(
    jsonb_object_agg(ss.room_player_id::text, true),
    '{}'::jsonb
  ) into public_submitted
  from public.submitted_selections ss
  where ss.room_id = p_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rp.id,
    'nickname', rp.nickname,
    'seat', rp.seat,
    'color', rp.color,
    'isHost', rp.client_identity = r.host_identity,
    'isMe', rp.id = me.id,
    'connected', rp.connected,
    'submitted', exists(
      select 1 from public.submitted_selections ss
      where ss.room_id = p_room_id and ss.room_player_id = rp.id
    ),
    'position', coalesce(
      r.game_state #> array['positions', rp.id::text],
      jsonb_build_object('space', 0, 'lane', rp.seat % 2)
    ),
    'gear', coalesce((r.game_state #>> array['gears', rp.id::text])::int, 1),
    'engineHeat', coalesce((
      select ps.engine_heat
      from public.player_private_state ps
      where ps.room_player_id = rp.id
    ), 6),
    'engineHeatCapacity', effective_capacity,
    'handCount', coalesce((
      select jsonb_array_length(ps.hand)
      from public.player_private_state ps
      where ps.room_player_id = rp.id
    ), 0),
    'deckCount', coalesce((
      select jsonb_array_length(ps.draw_deck)
      from public.player_private_state ps
      where ps.room_player_id = rp.id
    ), 0),
    'discardCount', coalesce((
      select jsonb_array_length(ps.discard)
      from public.player_private_state ps
      where ps.room_player_id = rp.id
    ), 0),
    'finished', coalesce((r.game_state #>> array['finished', rp.id::text])::boolean, false),
    'finishRank', (r.game_state #>> array['finishRanks', rp.id::text])::int,
    'finishRound', (r.game_state #>> array['finishRounds', rp.id::text])::int
  ) order by rp.seat), '[]'::jsonb) into public_players
  from public.room_players rp
  where rp.room_id = p_room_id;

  -- Never return the private submitted card IDs stored in game_state. Only the
  -- boolean projection is visible to other browsers.
  game := (r.game_state - 'submitted') || jsonb_build_object(
    'submitted', public_submitted,
    'players', coalesce((select jsonb_agg(
      jsonb_build_object(
        'id', rp.id,
        'name', rp.nickname,
        'color', rp.color,
        'seat', rp.seat,
        'gear', coalesce((r.game_state #>> array['gears', rp.id::text])::int, 1),
        'engineHeatCapacity', effective_capacity,
        'position', coalesce(
          r.game_state #> array['positions', rp.id::text],
          jsonb_build_object('space', 0, 'lane', rp.seat % 2)
        ),
        'hand', case when rp.id = me.id then coalesce(ps.hand, '[]'::jsonb) else '[]'::jsonb end,
        'deck', case when rp.id = me.id then coalesce(ps.draw_deck, '[]'::jsonb) else '[]'::jsonb end,
        'discard', case when rp.id = me.id then coalesce(ps.discard, '[]'::jsonb) else '[]'::jsonb end,
        'engineHeat', coalesce(ps.engine_heat, 6),
        'engine', case
          when rp.id <> me.id then '[]'::jsonb
          when coalesce(jsonb_array_length(ps.engine_cards), 0) > 0 then ps.engine_cards
          else (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', rp.id::text || '-engine-' || n::text,
              'kind', 'HEAT'
            )), '[]'::jsonb)
            from generate_series(1, coalesce(ps.engine_heat, 0)) n
          )
        end,
        'played', case when rp.id = me.id then coalesce(ps.played, '[]'::jsonb) else '[]'::jsonb end,
        'finished', coalesce((r.game_state #>> array['finished', rp.id::text])::boolean, false),
        'finishRank', (r.game_state #>> array['finishRanks', rp.id::text])::int,
        'finishRound', (r.game_state #>> array['finishRounds', rp.id::text])::int
      ) order by rp.seat
    ) from public.room_players rp
    left join public.player_private_state ps on ps.room_player_id = rp.id
    where rp.room_id = p_room_id), '[]'::jsonb),
    'privateHand', coalesce((
      select ps.hand from public.player_private_state ps where ps.room_player_id = me.id
    ), '[]'::jsonb)
  );

  return jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'hostPlayerId', (
      select id from public.room_players
      where room_id = p_room_id and client_identity = r.host_identity
    ),
    'status', r.status,
    'players', public_players,
    'game', game,
    'privateHand', coalesce((
      select ps.hand from public.player_private_state ps where ps.room_player_id = me.id
    ), '[]'::jsonb),
    'reconnectToken', me.reconnect_token
  );
end;
$$;

create or replace function public.get_room_snapshot(p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'ANONYMOUS_AUTH_REQUIRED'; end if;
  return public.build_room_snapshot(p_room_id, auth.uid());
end;
$$;

-- The Edge Function uses the service role to return the snapshot for the
-- authenticated caller after a commit. Ordinary browsers cannot impersonate
-- another identity through this helper.
create or replace function public.get_room_snapshot_for_identity(
  p_room_id uuid,
  p_client_identity uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_client_identity then
    raise exception 'IDENTITY_MISMATCH';
  end if;
  return public.build_room_snapshot(p_room_id, p_client_identity);
end;
$$;

create or replace function public.start_race(p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r public.rooms;
  rp record;
  deck jsonb;
  hand jsonb;
  draw_deck jsonb;
  engine_cards jsonb;
  track_config jsonb;
  starting_positions jsonb;
  adrenaline_ids jsonb;
  player_count integer;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists(
    select 1 from public.room_players
    where room_id = p_room_id
      and client_identity = auth.uid()
      and id = (
        select id from public.room_players
        where room_id = p_room_id and client_identity = r.host_identity
      )
  ) then raise exception 'HOST_ONLY'; end if;
  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if player_count < 2 then raise exception 'TWO_PLAYERS_REQUIRED'; end if;
  if player_count > 6 then raise exception 'SIX_PLAYERS_MAXIMUM'; end if;
  if r.status = 'RACING' and r.game_state->>'phase' <> 'FINISHED' then
    raise exception 'RACE_ALREADY_STARTED';
  end if;

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
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', rp.id::text || '-engine-heat-' || n::text,
      'kind', 'HEAT'
    )), '[]'::jsonb) into engine_cards
    from generate_series(0, 5) n;
    insert into public.player_private_state(
      room_player_id, hand, draw_deck, engine_cards, engine_heat
    ) values (rp.id, hand, draw_deck, engine_cards, 6);
  end loop;

  track_config := jsonb_build_object(
    'id', 'usa-beginner-starter',
    'name', 'USA - one-lap learning race',
    'laps', 1,
    'finishSpace', 69,
    'engineHeatCapacity', 6,
    'corners', jsonb_build_array(
      jsonb_build_object('id', 'corner-1', 'lineSpace', 6, 'speedLimit', 7, 'label', 'Turn 1'),
      jsonb_build_object('id', 'corner-2', 'lineSpace', 20, 'speedLimit', 3, 'label', 'Turn 2'),
      jsonb_build_object('id', 'corner-3', 'lineSpace', 26, 'speedLimit', 3, 'label', 'Turn 3'),
      jsonb_build_object('id', 'corner-4', 'lineSpace', 52, 'speedLimit', 2, 'label', 'Turn 4')
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

  -- Randomly fill the ascending official grid. The random assignment is
  -- generated in the database, never accepted from the browser.
  select coalesce(jsonb_object_agg(id::text, jsonb_build_object(
    'space', case when grid_index < 2 then 0 when grid_index < 4 then -1 else -2 end,
    'lane', grid_index % 2
  )), '{}'::jsonb) into starting_positions
  from (
    select id, (row_number() over (order by random()) - 1)::int as grid_index
    from public.room_players where room_id = p_room_id
  ) randomized;

  select coalesce(jsonb_agg(x.id::text order by x.space asc, x.lane desc, x.seat desc)
    filter (where x.rank_back <= case when player_count >= 5 then 2 else 1 end), '[]'::jsonb)
  into adrenaline_ids
  from (
    select y.*,
      row_number() over (order by y.space asc, y.lane desc, y.seat desc) as rank_back
    from (
      select rp.id, rp.seat,
        (starting_positions #>> array[rp.id::text, 'space'])::int as space,
        (starting_positions #>> array[rp.id::text, 'lane'])::int as lane
      from public.room_players rp where rp.room_id = p_room_id
    ) y
  ) x;

  update public.rooms
  set status = 'RACING',
      version = version + 1,
      game_state = jsonb_build_object(
        'version', 1,
        'phase', 'PLANNING',
        'round', 1,
        'startingPlayerCount', player_count,
        'stressReserve', 37 - player_count * 3,
        'resolutionOrder', '[]'::jsonb,
        'resolutionIndex', 0,
        'activePlayerId', null,
        'pending', null,
        'submitted', '{}'::jsonb,
        'adrenalineEligibleIds', adrenaline_ids,
        'nextCardId', 1,
        'winnerId', null,
        'log', jsonb_build_array(jsonb_build_object(
          'id', '1-1',
          'round', 1,
          'text', 'Race ready: everyone starts in 1st gear with seven cards.'
        )),
        'track', track_config,
        'positions', starting_positions,
        'gears', (select jsonb_object_agg(id::text, 1) from public.room_players where room_id = p_room_id),
        'finished', '{}'::jsonb,
        'finishRanks', '{}'::jsonb,
        'finishProgress', '{}'::jsonb,
        'finishRounds', '{}'::jsonb
      ),
      updated_at = now()
  where id = p_room_id;

  insert into public.room_events(room_id, version, kind, public_payload)
  select p_room_id, version, 'RACE_STARTED', jsonb_build_object('phase', 'PLANNING', 'round', 1)
  from public.rooms where id = p_room_id;
  return public.get_room_snapshot(p_room_id);
end;
$$;

-- The only state-changing action commit. It is intentionally callable by the
-- server-side service role, not by browser roles. The Edge Function performs
-- the readable TypeScript rule reduction, then this function applies the
-- complete snapshot under a room-version compare-and-swap lock.
create or replace function public.commit_game_state(
  p_room_id uuid,
  p_expected_version bigint,
  p_actor_identity uuid,
  p_action_nonce uuid,
  p_action_type text,
  p_public_payload jsonb,
  p_game_state jsonb,
  p_private_states jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r public.rooms;
  actor public.room_players;
  private_state jsonb;
  private_player_id uuid;
  plan_entry record;
  plan_player_id uuid;
  plan jsonb;
  new_engine_cards jsonb;
  player_count integer;
  next_version bigint;
  state_phase text;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.version <> p_expected_version then raise exception 'STALE_ROOM_VERSION'; end if;
  if exists(
    select 1 from public.room_events
    where room_id = p_room_id and public_payload->>'actionNonce' = p_action_nonce::text
  ) then raise exception 'DUPLICATE_ACTION'; end if;

  select * into actor
  from public.room_players
  where room_id = p_room_id and client_identity = p_actor_identity
  for update;
  if actor.id is null then raise exception 'NOT_A_ROOM_MEMBER'; end if;
  if coalesce(p_public_payload->>'playerId', '') <> actor.id::text then
    raise exception 'ACTOR_PLAYER_MISMATCH';
  end if;

  state_phase := p_game_state->>'phase';
  if coalesce(state_phase, '') not in (
    'LOBBY', 'DEALING', 'PLANNING', 'WAITING_FOR_PLAYERS',
    'RESOLVING_PLAYER', 'PLAYER_REACTION', 'ROUND_CLEANUP', 'FINISHED'
  ) then raise exception 'INVALID_GAME_PHASE'; end if;
  if p_action_type not in (
    'SUBMIT_PLAN', 'DISCARD_CARDS', 'ADRENALINE_SPEED',
    'ADRENALINE_COOLDOWN', 'BOOST', 'COOLDOWN', 'SLIPSTREAM', 'PASS_REACTION'
  ) then raise exception 'UNKNOWN_ACTION'; end if;

  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if jsonb_array_length(coalesce(p_private_states, '[]'::jsonb)) <> player_count then
    raise exception 'INCOMPLETE_PRIVATE_STATE';
  end if;

  if (
    select count(distinct value->>'playerId')
    from jsonb_array_elements(coalesce(p_private_states, '[]'::jsonb))
  ) <> player_count then
    raise exception 'DUPLICATE_PRIVATE_STATE';
  end if;

  for private_state in select value from jsonb_array_elements(coalesce(p_private_states, '[]'::jsonb)) loop
    private_player_id := (private_state->>'playerId')::uuid;
    if not exists(
      select 1 from public.room_players where room_id = p_room_id and id = private_player_id
    ) then raise exception 'PRIVATE_STATE_PLAYER_MISMATCH'; end if;
    new_engine_cards := coalesce(private_state->'engine', '[]'::jsonb);
    if jsonb_array_length(new_engine_cards) > 7 then raise exception 'ENGINE_OVER_CAPACITY'; end if;
    update public.player_private_state
    set hand = coalesce(private_state->'hand', '[]'::jsonb),
        draw_deck = coalesce(private_state->'drawDeck', '[]'::jsonb),
        discard = coalesce(private_state->'discard', '[]'::jsonb),
        engine_cards = new_engine_cards,
        engine_heat = jsonb_array_length(new_engine_cards),
        played = coalesce(private_state->'played', '[]'::jsonb),
        updated_at = now()
    where room_player_id = private_player_id;
  end loop;

  update public.rooms
  set status = case when state_phase = 'FINISHED' then 'FINISHED' else 'RACING' end,
      version = version + 1,
      game_state = p_game_state,
      updated_at = now()
  where id = p_room_id
  returning version into next_version;

  delete from public.submitted_selections where room_id = p_room_id;
  for plan_entry in select key, value from jsonb_each(coalesce(p_game_state->'submitted', '{}'::jsonb)) loop
    plan_player_id := plan_entry.key::uuid;
    plan := plan_entry.value;
    if not exists(
      select 1 from public.room_players where room_id = p_room_id and id = plan_player_id
    ) then raise exception 'SUBMISSION_PLAYER_MISMATCH'; end if;
    insert into public.submitted_selections(
      room_id, room_player_id, gear, card_ids, action_nonce, submitted_at
    ) values (
      p_room_id,
      plan_player_id,
      (plan->>'gear')::smallint,
      coalesce(plan->'cardIds', '[]'::jsonb),
      case when plan_player_id = actor.id then p_action_nonce else gen_random_uuid() end,
      to_timestamp(coalesce((plan->>'submittedAt')::double precision, extract(epoch from now())))
    );
  end loop;

  delete from public.finish_results where room_id = p_room_id;
  insert into public.finish_results(room_id, room_player_id, finish_rank, finished_round, final_space, final_lane)
  select
    p_room_id,
    rp.id,
    (p_game_state->'finishRanks'->>rp.id::text)::smallint,
    coalesce((p_game_state->'finishRounds'->>rp.id::text)::smallint, (p_game_state->>'round')::smallint),
    coalesce((((p_game_state->'positions')->(rp.id::text))->>'space')::smallint, 0),
    coalesce((((p_game_state->'positions')->(rp.id::text))->>'lane')::smallint, 0)
  from public.room_players rp
  where (p_game_state->'finished')->>(rp.id::text) = 'true'
    and (p_game_state->'finishRanks')->>(rp.id::text) is not null;

  insert into public.room_events(room_id, version, kind, public_payload)
  values (
    p_room_id,
    next_version,
    p_action_type,
    coalesce(p_public_payload, '{}'::jsonb) || jsonb_build_object(
      'actionNonce', p_action_nonce,
      'playerId', actor.id
    )
  );

  return public.build_room_snapshot(p_room_id, p_actor_identity);
end;
$$;

-- Retain the old function name as a hard stop so an old browser cannot use
-- the former record-only path to bypass the reducer. The deployed frontend
-- calls the submit-game-action Edge Function instead.
create or replace function public.submit_game_action(p_room_id uuid, p_action jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'AUTHORITATIVE_GAME_FUNCTION_REQUIRED';
end;
$$;

revoke execute on function public.submit_game_action(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.commit_game_state(uuid, bigint, uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.build_room_snapshot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_room_snapshot_for_identity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_room_snapshot(uuid) to authenticated, service_role;
grant execute on function public.start_race(uuid) to authenticated, service_role;
grant execute on function public.commit_game_state(uuid, bigint, uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.build_room_snapshot(uuid, uuid) to service_role;
grant execute on function public.get_room_snapshot_for_identity(uuid, uuid) to service_role;
