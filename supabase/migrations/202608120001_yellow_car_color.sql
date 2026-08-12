-- Keep existing rooms aligned with the V1 palette: the second car is yellow,
-- not orange. New rooms use the same palette through the current room RPCs.

update public.room_players
set color = '#f2c230'
where lower(trim(color)) = '#ee9a2f';

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

grant execute on function public.is_allowed_player_color(text) to authenticated;
