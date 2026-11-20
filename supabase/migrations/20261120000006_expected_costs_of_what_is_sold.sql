-- What a business expects selling and delivering something to cost, so Finance can set the margin it
-- expects beside the margin it recorded.
--
-- A priced item is what the business sells; the Work type it names is how it is delivered. The
-- expected cost of one unit is therefore two things the business states:
--
-- 1. Expected cost lines on the priced item: materials, parts, supplier charges, anything spent per
--    unit sold ("Tyre", "Disposal fee"). In the item's own currency, so a line can never be added up
--    against a price in another one.
-- 2. Expected time and a cost per hour on each stage of the delivering Work type: what the people and
--    equipment busy in that stage cost while they are. A business that drives to the customer gives
--    that delivery its own type with a Travel stage, so a tyre change at the customer's and one in the
--    workshop are two items with two expected costs.
--
-- Both are assumptions the business makes, never recorded cost: recorded cost stays
-- `work_item_costs`, and nothing here changes a quote, a job, an invoice or a report total. They are
-- read with `cost.read` and written with `cost.manage` (ADR-057's Finance cost permissions), because a
-- cost rate says what the business pays its people and suppliers. Prices stay readable as before.
--
-- 3. `work_type_results`: per Work type, the jobs moved into a finishing stage in a period with what
-- they were priced at and what they recorded as cost, and the jobs still open now. The forecast that
-- multiplies open jobs by an expected margin is calculated in the application from these figures and
-- the assumptions above, and stored nowhere.

-- 1. Expected cost lines on a priced item.
create table public.price_book_item_expected_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null,
  description text not null check (length(btrim(description)) between 1 and 120),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  foreign key (organization_id, item_id) references public.price_book_items(organization_id, id) on delete cascade
);
create index price_book_item_expected_costs_item_idx on public.price_book_item_expected_costs(organization_id, item_id);

comment on table public.price_book_item_expected_costs is
  'What a business expects to spend per unit of a priced item it sells (materials, parts, supplier charges). An assumption for planning, never a recorded cost. In the item''s currency. Read with cost.read, written with cost.manage.';

-- A line belongs to a unit-priced item and is in that item's currency; a re-priced item in another
-- currency keeps its old lines, which then read as not comparable rather than being converted.
create function app.expected_cost_matches_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_item public.price_book_items;
begin
  select * into v_item from public.price_book_items where organization_id = new.organization_id and id = new.item_id;
  if v_item.pricing_model <> 'unit' then
    raise exception 'Expected costs are recorded on items sold per unit.' using errcode = '22023';
  end if;
  if new.currency is distinct from v_item.currency then
    raise exception 'An expected cost is in the currency of the item it belongs to.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger price_book_item_expected_costs_match_item
  before insert or update on public.price_book_item_expected_costs
  for each row execute function app.expected_cost_matches_item();

alter table public.price_book_item_expected_costs enable row level security;
alter table public.price_book_item_expected_costs force row level security;
create policy price_book_item_expected_costs_select on public.price_book_item_expected_costs for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.read'));
create policy price_book_item_expected_costs_insert on public.price_book_item_expected_costs for insert to authenticated
  with check (organization_id in (select app.current_tenant_ids()) and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'cost.manage'));
create policy price_book_item_expected_costs_update on public.price_book_item_expected_costs for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.manage'));
create policy price_book_item_expected_costs_delete on public.price_book_item_expected_costs for delete to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.manage'));
grant select, delete on public.price_book_item_expected_costs to authenticated;
grant insert (organization_id, item_id, description, amount_minor, currency, created_by) on public.price_book_item_expected_costs to authenticated;
grant update (description, amount_minor) on public.price_book_item_expected_costs to authenticated;

-- 2. Expected time and cost per hour of a stage.
create table public.work_item_status_expected_costs (
  status_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expected_minutes integer not null check (expected_minutes between 1 and 100000),
  hourly_cost_minor bigint not null check (hourly_cost_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid() references auth.users(id),
  foreign key (organization_id, status_id) references public.work_item_statuses(organization_id, id) on delete cascade
);

comment on table public.work_item_status_expected_costs is
  'How long work of a type is expected to spend in one stage and what the people and equipment busy in it cost per hour. An assumption for planning, never a recorded cost. Read with cost.read, written with cost.manage.';

alter table public.work_item_status_expected_costs enable row level security;
alter table public.work_item_status_expected_costs force row level security;
create policy work_item_status_expected_costs_select on public.work_item_status_expected_costs for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.read'));
create policy work_item_status_expected_costs_insert on public.work_item_status_expected_costs for insert to authenticated
  with check (organization_id in (select app.current_tenant_ids()) and updated_by = (select auth.uid())
    and app.has_capability(organization_id, 'cost.manage'));
create policy work_item_status_expected_costs_update on public.work_item_status_expected_costs for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and updated_by = (select auth.uid())
    and app.has_capability(organization_id, 'cost.manage'));
create policy work_item_status_expected_costs_delete on public.work_item_status_expected_costs for delete to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'cost.manage'));
grant select, delete on public.work_item_status_expected_costs to authenticated;
grant insert (status_id, organization_id, expected_minutes, hourly_cost_minor, currency, updated_by) on public.work_item_status_expected_costs to authenticated;
grant update (expected_minutes, hourly_cost_minor, currency, updated_at, updated_by) on public.work_item_status_expected_costs to authenticated;

-- 3. What each Work type's jobs recorded.
create function public.work_type_results(
  p_organization_id uuid,
  p_currency text,
  p_from date default null,
  p_to date default null
)
returns table (
  type_id uuid,
  finished_jobs bigint,
  priced_jobs bigint,
  priced_minor bigint,
  cost_minor bigint,
  open_jobs bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_zone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not app.has_capability(p_organization_id, 'report.read') then
    raise exception 'you may not read this business''s figures' using errcode = '42501';
  end if;

  select o.timezone into v_zone from public.organizations o where o.id = p_organization_id;
  v_zone := coalesce(v_zone, 'UTC');
  v_from := case when p_from is not null then p_from::timestamp at time zone v_zone end;
  v_to := case when p_to is not null then p_to::timestamp at time zone v_zone end;

  return query
  with finished as (
    -- Jobs, not events: a job moved out of a finishing stage and back within the period finished once.
    select distinct w.id, w.type_id, w.source_proposal_id, w.source_proposal_position
      from public.events e
      join public.work_items w on w.organization_id = e.organization_id and w.id = e.entity_id
      join public.work_item_statuses s on s.organization_id = e.organization_id and s.id = (e.payload ->> 'to_status_id')::uuid
     where e.organization_id = p_organization_id
       and e.entity_type = 'work_item'
       and e.action = 'work_item.status_changed'
       and s.marks_complete
       and (v_from is null or e.occurred_at >= v_from)
       and (v_to is null or e.occurred_at < v_to)
  ),
  priced as (
    -- What the job was priced at in this currency: its own priced lines, or, for work delivered from
    -- an accepted customer quote, the quote line it delivers. Null when it has neither.
    select f.id,
           coalesce(
             (select sum(l.unit_amount_minor * l.quantity)::bigint from public.work_item_priced_lines l
               where l.organization_id = p_organization_id and l.work_item_id = f.id and l.currency = p_currency
              having count(*) > 0),
             (select q.amount_minor from public.customer_commercial_proposal_lines q
               where q.organization_id = p_organization_id and q.proposal_id = f.source_proposal_id
                 and q.position = f.source_proposal_position and q.currency = p_currency)
           ) as amount_minor,
           (select coalesce(sum(c.amount_minor), 0)::bigint from public.work_item_costs c
             where c.organization_id = p_organization_id and c.work_item_id = f.id and c.currency = p_currency) as cost_minor
      from finished f
  ),
  open_work as (
    -- Still to be done now: in a stage that neither finishes the work nor lets it go.
    select w.type_id, count(*)::bigint as jobs
      from public.work_items w
      join public.work_item_statuses s on s.organization_id = w.organization_id and s.id = w.status_id
     where w.organization_id = p_organization_id and not s.marks_complete and not s.releases_resource
     group by w.type_id
  )
  select t.id,
         count(f.id)::bigint,
         count(p.amount_minor)::bigint,
         coalesce(sum(p.amount_minor), 0)::bigint,
         -- Recorded cost of the priced jobs only, so it sits against the same jobs as the price.
         coalesce(sum(p.cost_minor) filter (where p.amount_minor is not null), 0)::bigint,
         coalesce(max(o.jobs), 0)::bigint
    from public.work_item_types t
    left join finished f on f.type_id = t.id
    left join priced p on p.id = f.id
    left join open_work o on o.type_id = t.id
   where t.organization_id = p_organization_id
   group by t.id;
end;
$fn$;

comment on function public.work_type_results(uuid, text, date, date) is
  'Per Work type: jobs moved into a finishing stage in the period, how many of them were priced in the currency and their priced and recorded-cost totals, and the jobs open now. Recorded figures only; expected figures are the application''s. Requires report.read.';
revoke execute on function public.work_type_results(uuid, text, date, date) from public;
grant execute on function public.work_type_results(uuid, text, date, date) to authenticated;
