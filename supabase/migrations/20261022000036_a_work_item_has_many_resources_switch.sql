-- A work item can have many resources: switch every reader and writer, then remove the old column.
--
-- `20261116000001` added the assignment relationship and copied every `work_items.resource_id`
-- into it. This file moves everything that used the column onto the relationship, and then drops
-- the column and its constraint — there is no period in which two things answer *who is on this
-- job*, and no "primary resource" left behind, because the product has no such concept.
--
-- **Semantics chosen where the old model could not say.**
--   * Unscheduling releases every resource's time and **keeps the assignments**: who is on a job
--     and when it happens are two facts, and forgetting the first because the second is undecided
--     would make dispatch start from nothing.
--   * `schedule_work_item` given no list leaves the assignments alone; an empty list clears them.
--     The old function read an omitted resource as "nobody" and silently took the person off the
--     job, which the assistant's executor had to work around.
--   * A report grouped by resource gives each assigned resource the whole job, so groups overlap
--     and their sum is not the business's total; a report grouped by anything else counts a job
--     once. `time_committed` counts resource-minutes: three resources on an hour is three.
--   * A condition on `resource_id` is true when any assigned resource satisfies it.

-- The old guarantee, replaced by `work_item_resource_assignments_resource_not_double_booked`.
alter table public.work_items drop constraint work_items_resource_not_double_booked;

-- The public view of commitments now reads the enforcement projection itself: "when is each
-- resource unavailable" and the constraint that refuses a second booking are the same rows, so the
-- two cannot disagree. Same columns, same scope, same definer shape.
create or replace view public.resource_commitments
with (security_invoker = off) as
select a.organization_id,
       a.resource_id,
       a.occupies
  from public.work_item_resource_assignments a
 where a.occupies is not null
   and (
     a.organization_id in (select app.current_tenant_ids())
     or a.organization_id = app.current_external_tenant()
   );

comment on view public.resource_commitments is
  'When each resource is unavailable, and nothing else. Reads the assignment-level occupancy that work_item_resource_assignments_resource_not_double_booked constrains, so availability and the guarantee are the same rows.';

CREATE OR REPLACE FUNCTION app.check_work_item_update_capability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if app.acting_automation() is not null then
    return new;
  end if;

  if new.status_id is distinct from old.status_id
     and not app.has_capability(new.organization_id, 'work_item.transition') then
    raise exception 'you may not move work item % between statuses', new.id
      using errcode = '42501';
  end if;

  if new.scheduled_during is distinct from old.scheduled_during
     and not app.has_capability(new.organization_id, 'work_item.schedule') then
    raise exception 'you may not schedule work item %', new.id
      using errcode = '42501';
  end if;

  if (new.title is distinct from old.title
      or new.customer_id is distinct from old.customer_id
      or new.location_id is distinct from old.location_id
      or new.asset_id is distinct from old.asset_id
      or new.custom is distinct from old.custom)
     and not app.has_capability(new.organization_id, 'work_item.update') then
    raise exception 'you may not edit the details of work item %', new.id
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.automation_conditions_hold(p_rule_id uuid, p_item work_items)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_condition public.automation_conditions;
  v_actual    text;
begin
  for v_condition in
    select * from public.automation_conditions
     where rule_id = p_rule_id
     order by position, created_at
  loop
    -- Resources are many, so this condition is about the set: *is set* means somebody is assigned,
    -- *is empty* means nobody is, and *equals* / *not equals* ask whether that resource is one of them.
    if v_condition.subject_field = 'resource_id' then
      if v_condition.operator = 'is_set' and not exists (
           select 1 from public.work_item_resource_assignments a
            where a.organization_id = p_item.organization_id and a.work_item_id = p_item.id) then
        return false;
      elsif v_condition.operator = 'is_empty' and exists (
           select 1 from public.work_item_resource_assignments a
            where a.organization_id = p_item.organization_id and a.work_item_id = p_item.id) then
        return false;
      elsif v_condition.operator = 'equals' and not exists (
           select 1 from public.work_item_resource_assignments a
            where a.organization_id = p_item.organization_id and a.work_item_id = p_item.id
              and a.resource_id::text = v_condition.value) then
        return false;
      elsif v_condition.operator = 'not_equals' and exists (
           select 1 from public.work_item_resource_assignments a
            where a.organization_id = p_item.organization_id and a.work_item_id = p_item.id
              and a.resource_id::text = v_condition.value) then
        return false;
      end if;
      continue;
    end if;

    v_actual := case v_condition.subject_field
      when 'title'       then p_item.title
      when 'status_id'   then p_item.status_id::text
      when 'type_id'     then p_item.type_id::text
      when 'customer_id' then p_item.customer_id::text
      when 'location_id' then p_item.location_id::text
      when 'asset_id'    then p_item.asset_id::text
      else p_item.custom ->> substring(v_condition.subject_field from 8)
    end;

    -- An empty string and a null are the same answer to "has this been filled in", and a form
    -- submits whichever it feels like. Treating them differently would make a rule behave
    -- differently depending on which screen wrote the row.
    if v_condition.operator = 'is_set' and coalesce(btrim(v_actual), '') = '' then
      return false;
    elsif v_condition.operator = 'is_empty' and coalesce(btrim(v_actual), '') <> '' then
      return false;
    elsif v_condition.operator = 'equals' and coalesce(v_actual, '') is distinct from v_condition.value then
      return false;
    elsif v_condition.operator = 'not_equals' and coalesce(v_actual, '') is not distinct from v_condition.value then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.work_at_risk(p_organization_id uuid)
 RETURNS TABLE(work_item_id uuid, title text, status text, reason text, scheduled_from timestamp with time zone, scheduled_to timestamp with time zone, starts_local text, ends_local text, time_zone text, resource text, customer text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select w.id,
         w.title,
         s.name,
         case
           when upper(w.scheduled_during) <= now() then 'window_passed'
           else 'nobody_assigned'
         end,
         lower(w.scheduled_during),
         upper(w.scheduled_during),
         to_char(lower(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         to_char(upper(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         o.timezone,
         rs.names,
         c.name
    from public.work_items w
    join public.work_item_statuses s
      on s.organization_id = w.organization_id
     and s.id = w.status_id
    join public.organizations o
      on o.id = w.organization_id
    left join lateral (
      select string_agg(r.name, ', ' order by r.name) as names
        from public.work_item_resource_assignments a
        join public.resources r
          on r.organization_id = a.organization_id
         and r.id = a.resource_id
       where a.organization_id = w.organization_id
         and a.work_item_id = w.id
    ) rs on true
    left join public.customers c
      on c.organization_id = w.organization_id
     and c.id = w.customer_id
   where w.organization_id = p_organization_id
     and w.scheduled_during is not null
     and not w.status_releases_resource
     and (
       upper(w.scheduled_during) <= now()
       or (
         rs.names is null
         and (lower(w.scheduled_during) at time zone o.timezone)::date
             = (now() at time zone o.timezone)::date
       )
     )
   order by lower(w.scheduled_during);
$function$;

CREATE OR REPLACE FUNCTION public.schedule_ahead(p_organization_id uuid, p_days integer DEFAULT 7)
 RETURNS TABLE(work_item_id uuid, title text, status text, starts_local text, ends_local text, time_zone text, resource text, customer text, starts_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select w.id,
         w.title,
         s.name,
         to_char(lower(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         to_char(upper(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         o.timezone,
         rs.names,
         c.name,
         lower(w.scheduled_during)
    from public.work_items w
    join public.work_item_statuses s
      on s.organization_id = w.organization_id
     and s.id = w.status_id
    join public.organizations o
      on o.id = w.organization_id
    left join lateral (
      select string_agg(r.name, ', ' order by r.name) as names
        from public.work_item_resource_assignments a
        join public.resources r
          on r.organization_id = a.organization_id
         and r.id = a.resource_id
       where a.organization_id = w.organization_id
         and a.work_item_id = w.id
    ) rs on true
    left join public.customers c
      on c.organization_id = w.organization_id
     and c.id = w.customer_id
   where w.organization_id = p_organization_id
     and w.scheduled_during is not null
     -- Work in a status the business marked as releasing its resource is off the board by that
     -- business's own definition, and showing it would make the diary look fuller than it is.
     and not w.status_releases_resource
     -- From the start of today in the business's own zone, so *this week* means what somebody
     -- there would mean by it rather than what UTC would.
     and upper(w.scheduled_during) >= date_trunc('day', now() at time zone o.timezone)
                                        at time zone o.timezone
     and lower(w.scheduled_during) < date_trunc('day', now() at time zone o.timezone)
                                        at time zone o.timezone
                                      + make_interval(days => greatest(p_days, 1))
   order by lower(w.scheduled_during);
$function$;

CREATE OR REPLACE FUNCTION public.invoiced_and_incurred(p_organization_id uuid, p_grouping text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_customer_id uuid DEFAULT NULL::uuid, p_resource_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(group_id uuid, group_label text, currency text, invoiced_minor bigint, incurred_minor bigint, margin_minor bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_zone text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  -- **The capability, and it is checked here rather than by a policy.**
  --
  -- `20260902000006` said adding a capability for what a tool reaches would be a mistake, on the
  -- grounds that a tool runs `security invoker` so the rows it returns are already decided by the
  -- policies their screens obey. That reasoning is correct and it is about **rows**. This function
  -- returns none: a year's billing per customer exists in no table, and nobody can read it one
  -- row at a time. Every other tool reshapes rows its caller could already see; an aggregate is a
  -- disclosure that did not previously exist, so the earlier argument does not reach it. Recorded
  -- here rather than left for somebody to find the two in conflict.
  --
  -- **Checked in the function because there is nothing yet to put a policy on.** The rows this
  -- reads -- invoices, their lines, costs -- must stay readable by any member, because a job
  -- screen shows all three. What is being gated is the summing, and the summing is this function.
  -- `schema-conformance.test.ts` therefore reads function bodies as well as policy expressions
  -- when it checks I16: what that invariant forbids is a capability enforced only in TypeScript,
  -- and a `security invoker` function raising on `app.has_capability` is no such thing --
  -- `add_member_by_email` has enforced `role.manage` exactly this way since M1.
  if not app.has_capability(p_organization_id, 'report.read') then
    raise exception 'you may not read this business''s figures'
      using errcode = '42501';
  end if;

  -- plpgsql rather than sql for this one line. An unknown grouping has to fail loudly: returning
  -- no rows would read as "this business billed nothing", and collapsing to a null key would read
  -- as "all of it, unattributed". Both are answers, and both are wrong. A model picks this
  -- argument from an enum in its schema and a screen picks it from a list, so arriving here at all
  -- means something is broken.
  if p_grouping not in ('customer', 'service', 'resource', 'location') then
    raise exception 'unknown grouping: %', p_grouping using errcode = '22023';
  end if;

  -- Once, rather than per row. `coalesce` to UTC covers the one case where this read comes back
  -- empty: a caller whose policies do not return the organizations row. They will get no
  -- amounts either, so the zone is moot -- but a null here would silently widen the period to
  -- everything, and a report that quietly ignores its own filter is worse than an empty one.
  select o.timezone into v_zone
    from public.organizations o
   where o.id = p_organization_id;

  v_zone := coalesce(v_zone, 'UTC');
  v_from := case when p_from is not null then p_from::timestamp at time zone v_zone end;
  v_to   := case when p_to   is not null then p_to::timestamp   at time zone v_zone end;

  return query
  with billed as (
    select w.customer_id,
           a.resource_id,
           w.location_id,
           l.description,
           l.currency,
           -- The price rule, in the second of its two expressions. Integer throughout and
           -- nothing rounds, because quantity is a whole number -- exactly as `priceWorkItem`
           -- says, and `reporting.test.ts` is what holds the two to it.
           l.unit_amount_minor * l.quantity as amount_minor
      from public.invoices i
      join public.invoice_lines l
        on l.organization_id = i.organization_id
       and l.invoice_id = i.id
      join public.work_items w
        on w.organization_id = i.organization_id
       and w.id = i.work_item_id
      left join public.work_item_resource_assignments a
        on (p_grouping = 'resource' or p_resource_id is not null)
       and a.organization_id = w.organization_id
       and a.work_item_id = w.id
       and (p_resource_id is null or a.resource_id = p_resource_id)
     where i.organization_id = p_organization_id
       and (v_from is null or i.issued_at >= v_from)
       and (v_to is null or i.issued_at < v_to)
       -- The filters, and they narrow the *jobs* rather than the amounts. Reading them off the
       -- work item means a job's revenue and its costs are included or excluded together, which
       -- is the same reason both sides take their grouping keys from there: a filter that kept
       -- one half of a job would produce a margin for work that was only partly counted.
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or a.resource_id is not null)
       and (p_location_id is null or w.location_id = p_location_id)
  ),
  spent as (
    select w.customer_id,
           a.resource_id,
           w.location_id,
           c.currency,
           c.amount_minor
      from public.work_item_costs c
      join public.work_items w
        on w.organization_id = c.organization_id
       and w.id = c.work_item_id
      left join public.work_item_resource_assignments a
        on (p_grouping = 'resource' or p_resource_id is not null)
       and a.organization_id = w.organization_id
       and a.work_item_id = w.id
       and (p_resource_id is null or a.resource_id = p_resource_id)
     where c.organization_id = p_organization_id
       and (v_from is null or c.incurred_at >= v_from)
       and (v_to is null or c.incurred_at < v_to)
       -- The filters, and they narrow the *jobs* rather than the amounts. Reading them off the
       -- work item means a job's revenue and its costs are included or excluded together, which
       -- is the same reason both sides take their grouping keys from there: a filter that kept
       -- one half of a job would produce a margin for work that was only partly counted.
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or a.resource_id is not null)
       and (p_location_id is null or w.location_id = p_location_id)
       -- A cost belongs to a job, not to one of its lines, so it has nowhere to go in a report
       -- grouped by service. Excluded here rather than nulled afterwards, so the group itself
       -- never appears with a misleading zero beside it.
       and p_grouping <> 'service'
  ),
  -- Both facts in one shape, so one `group by` decides where each lands. The zero on the other
  -- side of each branch is a real zero: a customer with costs and no invoice was billed nothing
  -- in this period, which is a true statement about a period rather than an absent answer.
  facts as (
    select case p_grouping
             when 'customer' then b.customer_id
             when 'resource' then b.resource_id
             when 'location' then b.location_id
           end                                            as group_id,
           case when p_grouping = 'service' then b.description end as service_label,
           b.currency,
           b.amount_minor                                 as invoiced,
           0::bigint                                      as incurred
      from billed b
     union all
    select case p_grouping
             when 'customer' then s.customer_id
             when 'resource' then s.resource_id
             when 'location' then s.location_id
           end,
           null,
           s.currency,
           0::bigint,
           s.amount_minor
      from spent s
  )
  select f.group_id,
         -- Today's name for an entity, and the snapshotted word for a service. `left join`
         -- throughout: a row a caller may not read leaves the label null rather than dropping the
         -- amount, which is D34's rule that a tool answers less and never wrongly.
         case p_grouping
           when 'customer' then cu.name
           when 'resource' then r.name
           -- `label` rather than `address`: a location's label is what the business calls the
           -- place, and an address on a report row is somebody's home in a list of totals.
           when 'location' then lo.label
           when 'service'  then f.service_label
         end,
         f.currency,
         sum(f.invoiced)::bigint,
         case when p_grouping = 'service' then null else sum(f.incurred)::bigint end,
         case when p_grouping = 'service' then null
              else (sum(f.invoiced) - sum(f.incurred))::bigint
         end
    from facts f
    left join public.customers cu
      on p_grouping = 'customer'
     and cu.organization_id = p_organization_id
     and cu.id = f.group_id
    left join public.resources r
      on p_grouping = 'resource'
     and r.organization_id = p_organization_id
     and r.id = f.group_id
    left join public.locations lo
      on p_grouping = 'location'
     and lo.organization_id = p_organization_id
     and lo.id = f.group_id
   group by f.group_id, 2, f.currency
   order by 4 desc, 2 nulls last;
end;
$function$;

CREATE OR REPLACE FUNCTION public.work_marked_complete(p_organization_id uuid, p_grouping text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_customer_id uuid DEFAULT NULL::uuid, p_resource_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(group_id uuid, group_label text, jobs bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_zone text;
  v_from timestamptz;
  v_to   timestamptz;
begin
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

  return query
  with finished as (
    select distinct
           e.entity_id as work_item_id,
           w.customer_id,
           a.resource_id,
           w.location_id
      from public.events e
      join public.work_items w
        on w.organization_id = e.organization_id
       and w.id = e.entity_id
      left join public.work_item_resource_assignments a
        on (p_grouping = 'resource' or p_resource_id is not null)
       and a.organization_id = w.organization_id
       and a.work_item_id = w.id
       and (p_resource_id is null or a.resource_id = p_resource_id)
      -- Which status it moved *into*, resolved against the tenant's own answer. The join is part
      -- of what this discloses (D34): a caller who may not read this business's board vocabulary
      -- gets nothing rather than a wrong count.
      join public.work_item_statuses s
        on s.organization_id = e.organization_id
       and s.id = (e.payload ->> 'to_status_id')::uuid
     where e.organization_id = p_organization_id
       and e.entity_type = 'work_item'
       and e.action = 'work_item.status_changed'
       and s.marks_complete
       and (v_from is null or e.occurred_at >= v_from)
       and (v_to is null or e.occurred_at < v_to)
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or a.resource_id is not null)
       and (p_location_id is null or w.location_id = p_location_id)
  )
  -- `distinct` above rather than here, and it is load-bearing: a job moved out of a finishing
  -- status and back into it within one period was finished once, not twice. Counting the events
  -- would make a business that corrects a mistake look busier than one that does not.
  select case p_grouping
           when 'customer' then f.customer_id
           when 'resource' then f.resource_id
           when 'location' then f.location_id
         end,
         case p_grouping
           when 'customer' then cu.name
           when 'resource' then r.name
           when 'location' then lo.label
         end,
         count(*)::bigint
    from finished f
    left join public.customers cu
      on p_grouping = 'customer'
     and cu.organization_id = p_organization_id
     and cu.id = f.customer_id
    left join public.resources r
      on p_grouping = 'resource'
     and r.organization_id = p_organization_id
     and r.id = f.resource_id
    left join public.locations lo
      on p_grouping = 'location'
     and lo.organization_id = p_organization_id
     and lo.id = f.location_id
   group by 1, 2
   order by 3 desc, 2 nulls last;
end;
$function$;

CREATE OR REPLACE FUNCTION public.time_committed(p_organization_id uuid, p_grouping text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_customer_id uuid DEFAULT NULL::uuid, p_resource_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(group_id uuid, group_label text, minutes bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
           a.resource_id,
           w.location_id,
           -- **The predicate, third expression.** an assignment and
           -- `occupies is not null` come from the join and `where` below; `not status_releases_resource`
           -- is the tenant's own answer about their own status, mirrored onto the row because a
           -- constraint predicate must be immutable. All three are the constraint's, written
           -- again — see this file's header for what that costs and what pays for it.
           w.occupies * v_period as inside
      from public.work_items w
      -- One row per assigned resource: this is resource time, so three resources on an hour is
      -- three resource-hours, and a job with nobody assigned commits none.
      join public.work_item_resource_assignments a
        on a.organization_id = w.organization_id
       and a.work_item_id = w.id
     where w.organization_id = p_organization_id
       and w.occupies is not null
       and not w.status_releases_resource
       and w.occupies && v_period
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or a.resource_id = p_resource_id)
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
$function$;

-- ---------------------------------------------------------------------------
-- Scheduling and assignment
-- ---------------------------------------------------------------------------

-- Reconciles a work item's assignments to exactly this set, inside the caller's transaction. A
-- conflict surfaces as 23P01 from the insert, which is also what rolls the deletions back: the
-- whole set is accepted or none of it is. Invoker rights on purpose — the assignment policies are
-- the authority, and this is only the shape of the write.
create function app.reconcile_work_item_resources(
  p_organization_id uuid,
  p_work_item_id    uuid,
  p_resource_ids    uuid[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_wanted uuid[] := coalesce(p_resource_ids, '{}'::uuid[]);
begin
  delete from public.work_item_resource_assignments a
   where a.organization_id = p_organization_id
     and a.work_item_id = p_work_item_id
     and not (a.resource_id = any (v_wanted));

  insert into public.work_item_resource_assignments
    (organization_id, work_item_id, resource_id, created_by)
  select p_organization_id, p_work_item_id, wanted.resource_id, v_actor
    from (select distinct unnest(v_wanted) as resource_id) wanted
   -- Not `on conflict do nothing`: that would also swallow an exclusion violation, and a resource
   -- that is busy must refuse the whole set, not quietly be left out of it.
   where not exists (
     select 1
       from public.work_item_resource_assignments existing
      where existing.organization_id = p_organization_id
        and existing.work_item_id = p_work_item_id
        and existing.resource_id = wanted.resource_id
   );
end;
$fn$;

revoke all on function app.reconcile_work_item_resources(uuid, uuid, uuid[]) from public;
grant execute on function app.reconcile_work_item_resources(uuid, uuid, uuid[]) to authenticated;

drop function public.schedule_work_item(uuid, uuid, timestamptz, timestamptz);

create function public.schedule_work_item(
  p_work_item_id uuid,
  p_resource_ids uuid[],
  p_starts_at    timestamptz,
  p_ends_at      timestamptz
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_ids   uuid[];
begin
  if v_actor is null then
    raise exception 'schedule_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'a scheduled window needs both a start and an end'
      using errcode = '23514';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'a scheduled window must end after it starts'
      using errcode = '23514';
  end if;

  -- Half-open, always, and built here rather than by the caller so that no caller can choose
  -- otherwise. The window moves first: its assignments follow it through
  -- `app.sync_assignment_occupies`, so every resource already on the job is tested against the
  -- new time before anything else changes.
  update public.work_items
     set scheduled_during = tstzrange(p_starts_at, p_ends_at, '[)')
   where id = p_work_item_id
  returning organization_id into v_org;

  -- A row refused by an UPDATE policy is invisible to the statement rather than an error, so
  -- without this the function would report success and write an event for work that was never
  -- scheduled. Same shape as assign_role and change_work_item_status.
  if v_org is null then
    raise exception 'no such work item, or you may not schedule it'
      using errcode = '42501';
  end if;

  -- Null leaves who is on the job alone; an empty list clears it. Either way it is the same
  -- transaction as the move above, so a resource that is busy refuses the whole thing.
  if p_resource_ids is not null then
    perform app.reconcile_work_item_resources(v_org, p_work_item_id, p_resource_ids);
  end if;

  select coalesce(array_agg(a.resource_id order by a.resource_id), '{}'::uuid[]) into v_ids
    from public.work_item_resource_assignments a
   where a.organization_id = v_org and a.work_item_id = p_work_item_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.scheduled',
     jsonb_build_object(
       'resource_ids', to_jsonb(v_ids),
       'starts_at', p_starts_at,
       'ends_at', p_ends_at
     ));
end;
$fn$;

revoke all on function public.schedule_work_item(uuid, uuid[], timestamptz, timestamptz) from public;
grant execute on function public.schedule_work_item(uuid, uuid[], timestamptz, timestamptz) to authenticated;

-- Takes the time away and keeps the people: see this file's header.
create or replace function public.unschedule_work_item(p_work_item_id uuid)
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
    raise exception 'unschedule_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_items
     set scheduled_during = null
   where id = p_work_item_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such work item, or you may not schedule it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.unscheduled', '{}'::jsonb);
end;
$fn$;

-- Who is on a job, changed on its own. One transaction for the whole set, and the capability is
-- `work_item.schedule`, the same authority that has always decided who is on a job.
create function public.set_work_item_resources(p_work_item_id uuid, p_resource_ids uuid[])
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_ids   uuid[];
begin
  if v_actor is null then
    raise exception 'set_work_item_resources requires an authenticated caller'
      using errcode = '42501';
  end if;

  select w.organization_id into v_org from public.work_items w where w.id = p_work_item_id;

  if v_org is null or not app.has_capability(v_org, 'work_item.schedule') then
    raise exception 'no such work item, or you may not schedule it'
      using errcode = '42501';
  end if;

  perform app.reconcile_work_item_resources(v_org, p_work_item_id, p_resource_ids);

  select coalesce(array_agg(a.resource_id order by a.resource_id), '{}'::uuid[]) into v_ids
    from public.work_item_resource_assignments a
   where a.organization_id = v_org and a.work_item_id = p_work_item_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.assigned',
     jsonb_build_object('resource_ids', to_jsonb(v_ids)));
end;
$fn$;

revoke all on function public.set_work_item_resources(uuid, uuid[]) from public;
grant execute on function public.set_work_item_resources(uuid, uuid[]) to authenticated;

drop function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb);

CREATE FUNCTION public.create_work_item(p_organization_id uuid, p_title text, p_status_id uuid, p_customer_id uuid, p_location_id uuid, p_resource_ids uuid[], p_asset_id uuid, p_custom jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_type  uuid;
  v_id    uuid;
  v_steps integer;
begin
  if v_actor is null then
    raise exception 'create_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Not SECURITY DEFINER, so this read is the caller's own: another tenant's status is not
  -- visible here and comes back null, exactly as a status that does not exist at all does.
  select s.type_id into v_type
    from public.work_item_statuses s
   where s.id = p_status_id
     and s.organization_id = p_organization_id;

  if v_type is null then
    -- The code a composite reference would have raised, because from the caller's position
    -- this is the same fact: no such status here.
    raise exception 'no such work item status in this organization'
      using errcode = '23503';
  end if;

  insert into public.work_items
    (organization_id, type_id, title, status_id, customer_id, location_id,
     asset_id, custom, created_by)
  values
    (p_organization_id, v_type, p_title, p_status_id, p_customer_id, p_location_id,
     p_asset_id, coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  -- Who is on it, from the start. Allowed to the creator for exactly this job and this
  -- transaction (`app.creating_work_item`); anyone changing it later needs `work_item.schedule`.
  if p_resource_ids is not null and cardinality(p_resource_ids) > 0 then
    perform set_config('app.creating_work_item', v_id::text, true);
    perform app.reconcile_work_item_resources(p_organization_id, v_id, p_resource_ids);
    perform set_config('app.creating_work_item', '', true);
  end if;

  -- The copy. Position and label are taken as they are now; nothing links back, so editing
  -- the template later cannot reach this job (I8).
  insert into public.work_item_checklist_items
    (organization_id, work_item_id, label, position, created_by)
  select t.organization_id, v_id, t.label, t.position, v_actor
    from public.work_item_type_checklist_items t
   where t.organization_id = p_organization_id
     and t.type_id = v_type
   order by t.position;

  get diagnostics v_steps = row_count;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_id, 'work_item.created',
     jsonb_build_object(
       'title', p_title,
       'type_id', v_type,
       'status_id', p_status_id,
       'customer_id', p_customer_id,
       'resource_ids', to_jsonb(coalesce(p_resource_ids, '{}'::uuid[])),
       'asset_id', p_asset_id,
       'checklist_items', v_steps
     ));

  return v_id;
end;
$function$;

revoke all on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid[], uuid, jsonb) from public;
grant execute on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid[], uuid, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.create_booking(p_organization_id uuid, p_type_id uuid, p_resource_id uuid, p_starts_at timestamp with time zone, p_name text, p_email text, p_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid := (select auth.uid());
  v_scope    uuid := app.current_external_tenant();
  v_type     public.work_item_types;
  v_email    text := nullif(btrim(p_email), '');
  v_customer uuid;
  v_item     uuid;
begin
  if v_actor is null then
    raise exception 'create_booking requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- **The whole authorization of this function, and it is one line.** This runs privileged, so
  -- nothing below is restrained by RLS -- every scope below is therefore written out rather
  -- than assumed. A caller bound to another business, or to none, stops here.
  if v_scope is null or v_scope is distinct from p_organization_id then
    raise exception 'you are not booking with this business'
      using errcode = '42501';
  end if;

  -- **Added by 20260829000010: re-checked rather than inferred from how the visitor got here.**
  -- The organization id is an argument, so a stranger holding one from before the switch was
  -- thrown would otherwise still commit work -- the same reasoning D17 gives about a path
  -- segment being routing convenience and never an authorization input.
  perform app.assert_module_enabled(p_organization_id, 'booking');

  -- One booking per visitor. Without this a single anonymous session could fill a diary, and
  -- the binding is the only thing that identifies them. A distinct SQLSTATE, because 23505 is
  -- also what a duplicate email raises and the two mean opposite things to a person.
  if exists (
    select 1
    from public.work_items w
    where w.organization_id = p_organization_id
      and w.created_by = v_actor
  ) then
    raise exception 'this visitor has already booked'
      using errcode = 'GD001';
  end if;

  select * into v_type
  from public.work_item_types
  where id = p_type_id
    and organization_id = p_organization_id
    and booking_status_id is not null;

  if v_type.id is null then
    raise exception 'that is not something this business takes bookings for'
      using errcode = '42501';
  end if;

  -- **A returning customer books against the record they already have.** The first draft
  -- created a new row every time and refused to look one up, on the grounds that matching an
  -- address somebody typed lets a stranger attach a booking to another customer's history.
  -- That reasoning was about *reading*, and the read policies above key on `created_by` rather
  -- than on the customer -- so attaching discloses nothing at all. What it does risk is a
  -- booking landing on the wrong person's record when somebody mistypes, which is a
  -- data-quality problem the business can see and fix, and a far smaller one than a business
  -- unable to take a second booking from its own customer.
  if v_email is not null then
    select c.id into v_customer
    from public.customers c
    where c.organization_id = p_organization_id
      and lower(c.email) = lower(v_email);
  end if;

  if v_customer is null then
    insert into public.customers (organization_id, name, email, phone, created_by)
    values (p_organization_id, p_name, v_email, nullif(btrim(p_phone), ''), v_actor)
    returning id into v_customer;
  end if;

  -- The duration is the type's, never the caller's. A caller who could choose it could book
  -- the van for a week. This is the one place a booking's shape is decided, and it is decided
  -- by what the business published.
  insert into public.work_items (
    organization_id, type_id, status_id, customer_id, title,
    scheduled_during, created_by
  )
  values (
    p_organization_id,
    p_type_id,
    v_type.booking_status_id,
    v_customer,
    v_type.name || ' — ' || p_name,
    tstzrange(
      p_starts_at,
      p_starts_at + make_interval(mins => v_type.booking_duration_minutes),
      '[)'
    ),
    v_actor
  )
  returning id into v_item;

  -- The one resource this booking takes. The assignment carries the window onto the resource's
  -- own row (`app.set_assignment_occupies`) and the exclusion constraint on it is what refuses a
  -- slot somebody else took — in this transaction, with nothing checked first.
  insert into public.work_item_resource_assignments
    (organization_id, work_item_id, resource_id, created_by)
  values (p_organization_id, v_item, p_resource_id, v_actor);

  -- **I6, and this is where it is proved rather than described.** Nothing checked whether the
  -- slot was still free. The exclusion constraint refuses this insert in the transaction that
  -- would have written it, which is the only re-assertion that does not race -- a check before
  -- the insert races identically, which is the whole content of that invariant.

  if v_type.booking_price_item_id is not null then
    perform public.add_work_item_priced_line(v_item, v_type.booking_price_item_id, 1);
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_item, 'work_item.booked',
     jsonb_build_object(
       'title', v_type.name,
       'customer_id', v_customer,
       'resource_ids', jsonb_build_array(p_resource_id),
       'starts_at', p_starts_at
     ));

  return v_item;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Contract: the column goes
-- ---------------------------------------------------------------------------

-- With its foreign key, its grants and its index. From here the assignment relationship is the
-- only answer to which resources are on a work item.
alter table public.work_items drop column resource_id;
