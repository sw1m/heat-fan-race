-- Add the course-owned engine capacity to game snapshots created before the
-- data-driven capacity field was introduced. The starter deck's extra Heat
-- card remains in the private deck and does not create another engine slot.

update public.rooms
set game_state = jsonb_set(game_state, '{track,engineHeatCapacity}', '6'::jsonb, true)
where jsonb_typeof(game_state->'track') = 'object';
