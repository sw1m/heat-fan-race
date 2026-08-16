-- Keep reconnect credentials and anonymous identities out of direct browser
-- table reads. Browsers receive the public member projection only through the
-- security-definer snapshot RPC.
revoke select on public.room_players from anon, authenticated;

-- Lobby joins and reconnects still need to wake existing browsers after the
-- direct room_players subscription is removed. The event contains no private
-- identity or reconnect-token data.
create or replace function public.notify_room_player_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_room uuid;
  changed_player uuid;
  next_version bigint;
begin
  if tg_op = 'DELETE' then
    changed_room := old.room_id;
    changed_player := old.id;
  else
    changed_room := new.room_id;
    changed_player := new.id;
  end if;
  update public.rooms
  set version = version + 1, updated_at = now()
  where id = changed_room
  returning version into next_version;

  if next_version is not null then
    insert into public.room_events(room_id, version, kind, public_payload)
    values (
      changed_room,
      next_version,
      case when tg_op = 'INSERT' then 'PLAYER_JOINED' else 'PLAYER_RECONNECTED' end,
      jsonb_build_object('playerId', changed_player)
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists room_players_join_event on public.room_players;
create trigger room_players_join_event
after insert or update of connected on public.room_players
for each row execute function public.notify_room_player_change();
