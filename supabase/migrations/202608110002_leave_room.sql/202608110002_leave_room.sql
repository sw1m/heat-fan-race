-- Leave a room without exposing a client-side state mutation boundary.
-- This is a standalone follow-up migration so projects that already applied
-- the initial schema can receive the leave action safely.
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

grant execute on function public.leave_room(uuid) to authenticated;
