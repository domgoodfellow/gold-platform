-- The aggregate layer, and it starts by refusing to say "revenue".
--
-- **D35 holds the decisions.** The short version: an aggregate is a `stable`, `security invoker`
-- function in this database — D34's shape for a tool, because a report *is* a tool the moment
-- somebody asks the assistant for one. `priceWorkItem` stays the price calculation and moves
-- nowhere; this function selects and groups lines, and `reporting.test.ts` asserts the two agree
-- on the same jobs. That correspondence is what keeps I4 true with the rule expressed twice, and
-- it is the mechanism I5 already uses for the availability predicate rather than a new idea.
--
-- **Two facts with two dates, named apart, because "revenue" is four different things.**
-- *Invoiced* is what a business billed, dated `invoices.issued_at`. *Incurred* is what a job
-- consumed, dated `work_item_costs.incurred_at`. Both of those are dates a person controls
-- rather than the instant somebody typed the row, which the migration before this one is what
-- made true. *Received* and *quoted* are named in D35 and deliberately absent: received is one
-- more column of the same shape and waits for somebody wanting a cash view, and quoted has no
-- business date at all — a priced line carries only `created_at` — which is the finding rather
-- than a gap to paper over.
--
-- **A business that prices here and invoices elsewhere sees an empty report.** That is the
-- honest answer under this design and it may describe most of them. Finding out is the point:
-- an empty report in front of a real business is the caller that earns a quote its own date.

-- ---------------------------------------------------------------------------
-- What may be grouped, and why two of these are not the same kind of key
-- ---------------------------------------------------------------------------

-- **Customer, resource and location group by id; service groups by a snapshotted word**, and the
-- asymmetry is deliberate rather than an inconsistency.
--
-- A customer is an entity with a row. Grouping by its id and rendering today's name is correct:
-- renaming a customer does not make last quarter's billing belong to somebody else, and a report
-- about *them* should say what they are called now. An invoice snapshots `billed_to` for the
-- opposite and equally correct reason — a document addressed to somebody must not change — and
-- this is not that document.
--
-- A service has no entity to point at. `work_item_priced_lines` and `invoice_lines` hold no
-- foreign key to `price_book_items` and none may be added (I4, I8), so the only thing a line
-- knows about what was sold is the description snapshotted onto it. That means renaming a
-- catalogue item splits this report in two, which is right: those were two things sold under two
-- names, and the line records what was agreed rather than what the catalogue says today.
--
-- **Both sides read the work item.** Revenue could be grouped by `invoices.customer_id` and cost
-- by `work_items.customer_id`, and where those disagree the same job's revenue and cost would
-- land in different rows and the margin would be wrong in both. One source for the grouping keys
-- is what makes the subtraction mean anything.

-- **The period is two dates and the zone is applied here, which is `20260902000009` again.**
-- That migration found a tool handing a model a UTC instant for a business in Cebu; this is the
-- same fact from the other end. A caller — a screen or a model — says *the first of August*,
-- and where August begins depends on where the business is. Handing this `timestamptz` would
-- push that conversion out to every caller, and one of those callers is a language model doing
-- arithmetic on dates with daylight saving in it. Postgres knows how, the tenant's zone is
-- already on the row, and it is applied once below rather than per row.
--
-- Half-open: `p_from` is included and `p_to` is not, so a month and the month after it share a
-- boundary and nothing is counted twice.
create function public.invoiced_and_incurred(
  p_organization_id uuid,
  p_grouping        text,
  p_from            date default null,
  p_to              date default null
)
returns table (
  -- Null for `service`, which has no entity, and null for work nothing is attributed to. The
  -- screen tells those two apart by which grouping it asked for; nothing here puts a word in a
  -- tenant's mouth for either.
  group_id       uuid,
  group_label    text,
  -- Part of the key, never a column beside it. Amounts carry the currency they were recorded in
  -- (I8, I10), so a business that changed what it trades in has two rows for one customer and no
  -- single figure. `totalCost` makes the same choice one level down.
  currency       text,
  invoiced_minor bigint,
  -- Null rather than zero when the question is not defined -- which is grouping by service, where
  -- a cost sits on the job and a service is one line on it. Zero would claim a service cost
  -- nothing.
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

comment on function public.invoiced_and_incurred(uuid, text, date, date) is
  'What a business billed and what its work consumed, grouped by customer, service, resource or location, each within one currency. Invoiced is dated by issued_at and incurred by incurred_at -- two business dates, never the instant a row was typed. Grouping by service returns no cost, because a cost belongs to a job rather than to one of its lines. An aggregate: stable, security invoker, narrowed by RLS rather than by its arguments. See D35.';

-- No new capability, and that is a decision rather than an omission. There is no read capability
-- anywhere in this platform -- no `customer.read`, no `work_item.read` -- because a member sees
-- their business's rows and RLS is what says so. This function reads rows the caller can already
-- read and computes nothing they could not compute from a screen, so a capability here would be
-- the first one with no policy behind it, which is what I16 refuses. Who may see *a saved report*
-- is a different question with a row to put a policy on, and it arrives with that row.
revoke execute on function public.invoiced_and_incurred(uuid, text, date, date) from public;
grant execute on function public.invoiced_and_incurred(uuid, text, date, date) to authenticated;
