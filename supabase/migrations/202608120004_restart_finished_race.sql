-- Allow the host to reset a completed race without creating a new room.
-- Some older action paths leave rooms.status as RACING while the authoritative
-- game state is already FINISHED, so the phase is part of the restart guard.

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
    insert into public.player_private_state(room_player_id, hand, draw_deck, engine_heat)
      values (rp.id, hand, draw_deck, 6);
  end loop;

  track_config := jsonb_build_object(
    'id', 'usa-beginner-starter',
    'name', 'USA - one-lap learning race',
    'laps', 1,
    'finishSpace', 40,
    'engineHeatCapacity', 6,
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

grant execute on function public.start_race(uuid) to authenticated;
