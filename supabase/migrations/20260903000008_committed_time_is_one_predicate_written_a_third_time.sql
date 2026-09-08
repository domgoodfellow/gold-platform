-- How much time a business has committed, and the third place one predicate is written.
--
-- **This is the sharp one in M7 and the reason it went last.** What counts as a commitment is
-- `work_items_resource_not_double_booked`'s partial predicate — a resource, an `occupies` range,
-- and a status the tenant has not said releases the resource. That predicate already exists
-- twice: as the exclusion constraint, and as `listSchedule`'s filters, and I5 is held up by
-- `availability.test.ts` asserting the two agree in both directions rather than by one of them
-- having been deleted. This is the third, and it is admitted under exactly the terms D35 set for
-- the second price calculation: `reporting.test.ts` runs the same jobs through `listSchedule` and
-- through this function and fails on any disagreement.
--
-- **A clause added to one of the three and not the others breaks I5 rather than a test**, which
-- is the whole reason that sentence is written down. Repair a failure by teaching this function
-- what the constraint learned, never by relaxing the assertion.
--
-- **What this is not is utilisation.** A percentage needs a denominator — opening hours minus
-- commitments — and that is `freeWindows`, the one availability calculation. An aggregate
-- re-deriving it would be a second answer to *what is free*, which is the thing I5 exists to
-- forbid, and no correspondence test would make that safe because the second answer would be
-- the one people acted on. So this reports the numerator and says so, and a business dividing it
-- by its own opening hours is doing arithmetic this platform did not invent for it.
--
-- **Time is clipped to the period, not counted whole.** A job running from the last day of one
-- month into the first of the next belongs to both, in the proportion it actually occupied —
-- `occupies * tstzrange(...)` is the intersection, and counting the whole window in both months
-- would report more committed time than exists.

create function public.time_committed(
  p_organization_id uuid,
  p_grouping        text,
  p_from            date default null,
  p_to              date default null,
  p_customer_id     uuid default null,
  p_resource_id     uuid default null,
  p_location_id     uuid default null
)
returns table (
  group_id    uuid,
  group_label text,
  minutes     bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_zone   text;
  v_from   timestamptz;
  v_to     timestamptz;
  v_period tstzrange;
begin
  -- No service grouping, for the reason completed work has none: time is committed by a job as a
  -- whole, and splitting one booking across the priced lines on it would mean inventing a rule.
  if p_grouping not in ('customer', 'resource', 'location') then
    raise exception 'unknown grouping: %', p_grouping using errcode = '22023';
  end if;

  if not app.has_capability(p_organization_id, 'report.read') then
    raise exception 'you may not read this business''s figures'
      using errcode = '42501';
  end if;

  select o.timezone into v_zone
    from public.organizations o
   where o.id = p_organization_id;

  v_zone := coalesce(v_zone, 'UTC');
  v_from := case when p_from is not null then p_from::timestamp at time zone v_zone end;
  v_to   := case when p_to   is not null then p_to::timestamp   at time zone v_zone end;

  -- Unbounded on either side when that end was not given, so "everything" is a range rather than
  -- a branch: the intersection below then leaves each window whole.
  v_period := tstzrange(v_from, v_to, '[)');

  return query
  with committed as (
    select w.customer_id,
           w.resource_id,
           w.location_id,
           -- **The predicate, third expression.** `resource_id is not null` and
           -- `occupies is not null` come from the `where` below; `not status_releases_resource`
           -- is the tenant's own answer about their own status, mirrored onto the row because a
           -- constraint predicate must be immutable. All three are the constraint's, written
           -- again — see this file's header for what that costs and what pays for it.
           w.occupies * v_period as inside
      from public.work_items w
     where w.organization_id = p_organization_id
       and w.resource_id is not null
       and w.occupies is not null
       and not w.status_releases_resource
       and w.occupies && v_period
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or w.resource_id = p_resource_id)
       and (p_location_id is null or w.location_id = p_location_id)
  )
  select case p_grouping
           when 'customer' then c.customer_id
           when 'resource' then c.resource_id
           when 'location' then c.location_id
         end,
         case p_grouping
           when 'customer' then cu.name
           when 'resource' then r.name
           when 'location' then lo.label
         end,
         -- Summed in seconds and divided once, for the reason `formatMoney` divides once: a
         -- rounding per row is a rounding repeated, and the total then disagrees with itself.
         round(sum(extract(epoch from (upper(c.inside) - lower(c.inside)))) / 60)::bigint
    from committed c
    left join public.customers cu
      on p_grouping = 'customer'
     and cu.organization_id = p_organization_id
     and cu.id = c.customer_id
    left join public.resources r
      on p_grouping = 'resource'
     and r.organization_id = p_organization_id
     and r.id = c.resource_id
    left join public.locations lo
      on p_grouping = 'location'
     and lo.organization_id = p_organization_id
     and lo.id = c.location_id
   group by 1, 2
   order by 3 desc, 2 nulls last;
end;
$fn$;

comment on function public.time_committed(uuid, text, date, date, uuid, uuid, uuid) is
  'How many minutes of resource time a business has committed in a period, grouped by customer, resource or location, clipped to that period. The third expression of work_items_resource_not_double_booked''s predicate after the constraint and listSchedule, admitted on D35''s terms and pinned by a correspondence test. It is the numerator of utilisation and deliberately not utilisation: a percentage needs freeWindows, and a second answer to what is free is what I5 forbids. Requires report.read.';

revoke execute on function public.time_committed(uuid, text, date, date, uuid, uuid, uuid) from public;
grant execute on function public.time_committed(uuid, text, date, date, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A third thing a saved report can be
-- ---------------------------------------------------------------------------

alter table public.report_definitions
  drop constraint report_definitions_measure_check;

alter table public.report_definitions
  add constraint report_definitions_measure_check
  check (measure in ('invoiced_and_incurred', 'work_marked_complete', 'time_committed'));

-- Both of the measures that count something about a job as a whole refuse a service grouping, and
-- the constraint now names them rather than the one. Refused when the report is **saved** so a
-- report whose only outcome is a failure never appears as a thing somebody can click.
alter table public.report_definitions
  drop constraint report_definitions_grouping_answerable;

alter table public.report_definitions
  add constraint report_definitions_grouping_answerable
  check (measure = 'invoiced_and_incurred' or grouping <> 'service');
