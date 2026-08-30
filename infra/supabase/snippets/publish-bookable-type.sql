-- Publish a kind of work to the public booking page. Hand-run, local only, never applied by a
-- migration.
--
-- **This snippet is evidence of a gap, not a fix for it.** `setTypeBookable` exists in the
-- domain layer and `public.set_type_bookable` exists in the database, and neither has a route,
-- a form or a button behind it -- so a business cannot publish a bookable service without
-- somebody opening the database. M4's criterion is that "nobody at that business has ever been
-- given database credentials", and this file is the operator path that criterion is missing.
-- It exists so `/book/{slug}` can be walked by hand (see `docs/walkthrough.md`) and should be
-- deleted the day a screen does this.
--
-- It does not go through `set_type_bookable`, because that function reads `auth.uid()` and psql
-- has no session. It therefore also writes no event, which a real caller would.
--
--   docker exec -i supabase_db_infra psql -U postgres -d postgres \
--     -f - < infra/supabase/snippets/publish-bookable-type.sql
--
-- Then: Settings -> give the business a URL name and switch Public booking on, and open
-- /book/{that name} in a private window.

\set ON_ERROR_STOP on

do $$
declare
  -- Which business. Required rather than inferred: psql runs as superuser and sees every
  -- tenant, so a type name alone is ambiguous the moment a second organization exists -- which
  -- is the whole point of this platform and exactly the mistake a hand-run script makes.
  v_org_name    text := 'CHANGE ME';
  -- Which type to publish, and which of *its own* statuses a booking arrives in. Edit these
  -- two names to match what you configured; the status must belong to this type, which is what
  -- the composite foreign key on `work_item_types` enforces.
  v_type_name   text := 'CHANGE ME';
  v_status_name text := 'CHANGE ME';
  -- How long one booking takes. Between 5 and 1440, held by
  -- `work_item_types_bookable_is_complete` -- there is no platform default for this and no
  -- snippet should invent one, so it is spelled out here.
  v_minutes     integer := 60;

  v_type_id   uuid;
  v_status_id uuid;
  v_matches   integer;
begin
  -- Two organizations may hold the same name -- M1's test proves exactly that -- so an
  -- ambiguous match has to stop rather than pick one. `select into` would silently take the
  -- first row.
  select count(*) into v_matches
    from public.work_item_types t
    join public.organizations o on o.id = t.organization_id
   where o.name = v_org_name
     and t.name = v_type_name;

  if v_matches > 1 then
    raise exception '% businesses called % have a %. Narrow this snippet by id.',
      v_matches, v_org_name, v_type_name;
  end if;

  select t.id into v_type_id
    from public.work_item_types t
    join public.organizations o on o.id = t.organization_id
   where o.name = v_org_name
     and t.name = v_type_name;

  if v_type_id is null then
    raise exception 'no work item type named % in %. Create it in Work -> Kinds of work first.',
      v_type_name, v_org_name;
  end if;

  select id into v_status_id
    from public.work_item_statuses
   where work_item_type_id = v_type_id
     and name = v_status_name;

  if v_status_id is null then
    raise exception 'type % has no status named %. A booking has to arrive somewhere.',
      v_type_name, v_status_name;
  end if;

  -- Non-null is what "bookable" means. There is deliberately no `bookable` boolean to
  -- contradict these two columns, so clearing them is how a business stops publishing.
  update public.work_item_types
     set booking_status_id        = v_status_id,
         booking_duration_minutes = v_minutes
   where id = v_type_id;

  raise notice 'published % (booking arrives in %, % minutes)',
    v_type_name, v_status_name, v_minutes;
end;
$$;
