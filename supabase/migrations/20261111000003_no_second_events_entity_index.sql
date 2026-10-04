-- `events_entity_idx` (20261111000001) repeated `events_org_entity_idx`, which already serves a
-- conversation's activity read (organization, entity type, entity id, newest first) — a second index on
-- the same key is only a second thing to maintain on every event written. Dropped.
drop index if exists public.events_entity_idx;
