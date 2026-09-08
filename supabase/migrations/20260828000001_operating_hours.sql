-- Operating hours: when a business is open, as that business's own configuration.
--
-- `constraints.md` forbids hardcoding business hours, and the availability calculation
-- shipped without them for exactly that reason -- a 9-to-5 in the domain layer would have
-- been the forbidden thing wearing a default's clothing. This migration gives the rule
-- somewhere to live that a business owns.
--
-- **Nothing here assumes a working week.** There are no seeded rows, no Monday-to-Friday, no
-- notion of a weekend, and no default. A business that has said nothing about its hours is
-- treated as always open, because that is what "it has said nothing" means -- contrast I13,
-- where an unconfigured type is FROZEN, and the asymmetry is deliberate. An unconfigured
-- transition set genuinely asserts that no move is legal, and reading it permissively would
-- void the invariant silently. An unconfigured hours set asserts nothing at all, and reading
-- it as "closed" would invent a claim the business never made -- while voiding no invariant,
-- because I5 is about there being one calculation, not about what it subtracts.
--
-- The one thing that IS assumed is that a week has seven days and repeats. That is a property
-- of the calendar every one of these businesses already uses, not an assumption about any of
-- them. Which of those days a business works, and for how long, is entirely its own.

-- ---------------------------------------------------------------------------
-- operating_hours
-- ---------------------------------------------------------------------------

create table public.operating_hours (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- ISO 8601 numbering: 1 = Monday through 7 = Sunday. A number rather than a name because
  -- the platform must not hold a word for a day in any language -- rendering it is the
  -- caller's problem and the reader's locale's business.
  day_of_week     smallint    not null check (day_of_week between 1 and 7),

  -- `time`, NOT `timestamptz`, and this is the one place in the schema where that is right.
  --
  -- "Time is timestamptz" (constraints.md) governs INSTANTS -- a moment something happened or
  -- will happen. "We open at nine" is not an instant: it is a recurring local wall-clock
  -- reading, and there is no answer to "which nine". Stored as an instant it would be an
  -- instant on some arbitrary date, and it would drift by an hour twice a year the moment the
  -- tenant's zone changed offset -- which is precisely the bug the rule exists to prevent,
  -- arrived at from the other direction.
  --
  -- It is resolved against the organization's IANA zone at the moment a day is calculated,
  -- which is I9's machinery doing exactly what I9 says: absolute instants, rendered -- and
  -- here, derived -- in the tenant's timezone.
  opens_at        time        not null,
  closes_at       time        not null,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- A closing time before its opening time is a row nobody can act on. Midnight-crossing
  -- shifts -- open 22:00, close 02:00 -- are therefore two rows on two days, which is what
  -- they actually are, rather than one row with a wraparound rule every reader must know.
  constraint operating_hours_closes_after_opens check (closes_at > opens_at)
);

comment on table public.operating_hours is
  'When this business is open, per weekday, in its own timezone. No rows means no claim, which is read as always open.';

-- I2. Two businesses opening at the same time on the same day is the ordinary case; the same
-- business declaring the same opening twice is a duplicate.
create unique index operating_hours_org_day_opens_unique
  on public.operating_hours (organization_id, day_of_week, opens_at);

create index operating_hours_org_day_idx
  on public.operating_hours (organization_id, day_of_week);

-- Deliberately no exclusion constraint against overlapping hours on one day. Two rows that
-- overlap are a business describing the same open period twice, which is untidy and not
-- wrong: `freeWindows` merges overlapping windows before subtracting, so the answer is
-- identical either way. A constraint here would refuse a harmless row with a bare 23P01, and
-- I7's exclusion constraint exists because double-booking a technician is genuinely
-- impossible -- this is not that.

alter table public.operating_hours enable row level security;
alter table public.operating_hours force row level security;

create policy operating_hours_select on public.operating_hours
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- field.manage: declaring when the business is open is changing the shape of what it does,
-- the same act as naming a board column.
create policy operating_hours_insert on public.operating_hours
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

-- Delete rather than update, deliberately. An opening period is a small whole thing; editing
-- one in place needs a form that can express "change the end but not the start", and removing
-- it and adding the corrected one says the same thing with no second write path. Unlike a
-- cost or a timesheet, this is configuration rather than history, so removal loses nothing.
create policy operating_hours_delete on public.operating_hours
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  );

grant select, insert, delete on public.operating_hours to authenticated;

-- ---------------------------------------------------------------------------
-- Writing, as one transaction
-- ---------------------------------------------------------------------------

create function public.add_operating_hours(
  p_organization_id uuid,
  p_day_of_week     smallint,
  p_opens_at        time,
  p_closes_at       time
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'add_operating_hours requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.operating_hours
    (organization_id, day_of_week, opens_at, closes_at, created_by)
  values (p_organization_id, p_day_of_week, p_opens_at, p_closes_at, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'operating_hours', v_id, 'operating_hours.added',
     jsonb_build_object(
       'day_of_week', p_day_of_week,
       'opens_at', p_opens_at,
       'closes_at', p_closes_at
     ));

  return v_id;
end;
$fn$;

revoke all on function public.add_operating_hours(uuid, smallint, time, time) from public;
grant execute on function public.add_operating_hours(uuid, smallint, time, time) to authenticated;

create function public.remove_operating_hours(p_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'remove_operating_hours requires an authenticated caller'
      using errcode = '42501';
  end if;

  delete from public.operating_hours
   where id = p_id
  returning organization_id into v_org;

  -- A row refused by the DELETE policy is invisible to the statement rather than an error,
  -- so without this the event would record a removal that never happened.
  if v_org is null then
    raise exception 'no such operating hours, or you may not change them'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'operating_hours', p_id, 'operating_hours.removed', '{}'::jsonb);
end;
$fn$;

revoke all on function public.remove_operating_hours(uuid) from public;
grant execute on function public.remove_operating_hours(uuid) to authenticated;
