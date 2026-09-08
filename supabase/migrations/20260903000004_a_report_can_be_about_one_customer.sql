-- A report can be about one customer, one resource or one place.
--
-- **Filters, and they are columns rather than a language.** D36 settles what a saved report may
-- express, and this is the half of it the aggregate has to understand: a grouping, a period, and
-- optionally one entity to narrow to. Everything else the source's §17 lists -- entity, fields,
-- calculations -- is already fixed for this report set. The entity *is* the grouping, the fields
-- are the three money columns, and the calculation is the subtraction. So there is nothing left
-- for a query language to express, which is why there is not one.
--
-- Each filter is a uuid the caller already holds, checked by nothing here: a customer id from
-- another business narrows to no rows because RLS never lets those rows into the query in the
-- first place. That is the same reason the organization id is not what narrows (D34) -- an
-- argument a caller chooses can never be the protection.
--
-- Replaced rather than altered: three new parameters is a new signature, so this drops and
-- recreates. Everything below is `20260903000003` with the predicates added.
drop function public.invoiced_and_incurred(uuid, text, date, date);

create function public.invoiced_and_incurred(
  p_organization_id uuid,
  p_grouping        text,
  p_from            date default null,
  p_to              date default null,
  p_customer_id     uuid default null,
  p_resource_id     uuid default null,
  p_location_id     uuid default null
)
returns table (
  group_id       uuid,
  group_label    text,
  currency       text,
  invoiced_minor bigint,
  incurred_minor bigint,
  margin_minor   bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
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
           w.resource_id,
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
     where i.organization_id = p_organization_id
       and (v_from is null or i.issued_at >= v_from)
       and (v_to is null or i.issued_at < v_to)
       -- The filters, and they narrow the *jobs* rather than the amounts. Reading them off the
       -- work item means a job's revenue and its costs are included or excluded together, which
       -- is the same reason both sides take their grouping keys from there: a filter that kept
       -- one half of a job would produce a margin for work that was only partly counted.
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or w.resource_id = p_resource_id)
       and (p_location_id is null or w.location_id = p_location_id)
  ),
  spent as (
    select w.customer_id,
           w.resource_id,
           w.location_id,
           c.currency,
           c.amount_minor
      from public.work_item_costs c
      join public.work_items w
        on w.organization_id = c.organization_id
       and w.id = c.work_item_id
     where c.organization_id = p_organization_id
       and (v_from is null or c.incurred_at >= v_from)
       and (v_to is null or c.incurred_at < v_to)
       -- The filters, and they narrow the *jobs* rather than the amounts. Reading them off the
       -- work item means a job's revenue and its costs are included or excluded together, which
       -- is the same reason both sides take their grouping keys from there: a filter that kept
       -- one half of a job would produce a margin for work that was only partly counted.
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or w.resource_id = p_resource_id)
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
$fn$;

comment on function public.invoiced_and_incurred(uuid, text, date, date, uuid, uuid, uuid) is
  'What a business billed and what its work consumed, grouped by customer, service, resource or location, each within one currency, optionally narrowed to one customer, resource or place. Requires report.read. See D35 and D36.';

revoke execute on function public.invoiced_and_incurred(uuid, text, date, date, uuid, uuid, uuid) from public;
grant execute on function public.invoiced_and_incurred(uuid, text, date, date, uuid, uuid, uuid) to authenticated;
