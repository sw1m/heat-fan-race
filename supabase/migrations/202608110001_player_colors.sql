-- Allow each human racer to choose one of the four table colors before joining.
-- Existing rooms keep their assigned colors; new joins are rejected when a color is taken.

create or replace function public.is_allowed_player_color(p_color text) returns boolean
language sql immutable as $$
  select lower(trim(p_color)) = any(array['#d44735', '#ee9a2f', '#245c8c', '#2f7a54']::text[]);
$$;

drop function if exists public.create_race_room(text, uuid);
drop function if exists public.join_race_room(text, text, uuid, uuid);

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
  select coalesce(min(candidate.seat), 4) into next_seat
    from generate_series(0, 3) as candidate(seat)
    where not exists (
      select 1 from public.room_players
      where room_id = r.id and room_players.seat = candidate.seat
    );
  if next_seat >= 4 then raise exception 'ROOM_FULL'; end if;
  insert into public.room_players(room_id, client_identity, nickname, seat, color)
    values (r.id, auth.uid(), public.unique_room_nickname(r.id, p_nickname), next_seat, chosen_color);
  return public.get_room_snapshot(r.id);
end;
$$;

grant execute on function public.is_allowed_player_color(text) to authenticated;
grant execute on function public.create_race_room(text, uuid, text) to authenticated;
grant execute on function public.join_race_room(text, text, uuid, uuid, text) to authenticated;
