-- An allowance stops being package metadata and becomes one runtime answer.
--
-- `platform_plan_quotas` could already say *what rows apply*. Nothing could say *what this
-- business is allowed to consume right now*: `organization_effective_quotas` returns one row per
-- contributing Plan with overrides applied, which is the raw provenance and not a resolved
-- allowance -- two Plans contributing to one allowance key came back as two rows, nothing
-- resolved a period into real boundaries, and nothing counted consumption at all.
--
-- **Where this lives, and why it is SQL.** The decision and the usage write are one commercial
-- operation: two concurrent calls must not both see the last included unit (A9). An enforcement
-- point reachable from a screen but not from `open_call`, an automation or a provider callback is
-- a disabled button, which is the thing D40's own credit gate already refused to be. So the
-- calculation lives in one SQL function the way `app.record_usage` and `freeWindows`' constraint
-- predicate do, and `lib/domain/` calls it rather than deriving a second answer (I4/I5).
--
-- **Raw contribution and resolved allowance stay separate.** `organization_effective_quotas` is
-- untouched and keeps its callers; `app.allowance_states` returns the resolved allowance with
-- every contribution still attached as `contributions`, so "which Plan gave us this, and was it
-- overridden" survives resolution.
--
-- **Composition is declared, never a consequence of query order.** Contributions to one
-- allowance key must agree on semantic identity -- allowance type, unit, period, reset
-- semantics, meter, service class, overage policy and behaviour. Quantities may differ, because
-- an Add-on exists to add capacity, and compatible quantities are summed. Disagreement is
-- reported as `configuration_error` naming the axis; it is never silently resolved by picking a
-- row, and never double-counted as though it had agreed.

-- ---------------------------------------------------------------------------
-- 1. The catalogue's own disagreements, fixed where they are
-- ---------------------------------------------------------------------------
-- Writing the validation above found four real ones in shipped seed data, all of the same shape:
-- the archived launch snapshot (20260924000001) gave every seat and number count a monthly
-- billing period, and the production ladder (20261015000002) gave the same keys no period at all.
-- `additional_user` attaches to `start`, and `local_phone_number` to `scale`, so those pairs
-- really do meet on one organization.
--
-- **A seat or a number is a standing count, not a periodic consumption.** Five users does not
-- mean five users per month, and there is no sense in which it resets; a count asked at a moment
-- is the whole of it. So the ladder's answer is the correct one and the snapshot's rows are
-- corrected to match, which also makes every one of these allowances a point-in-time count whose
-- window is purely descriptive.
update public.platform_plan_quotas
   set period = 'none', reset_semantics = 'none'
 where allowance_key in ('users', 'calling_users', 'technicians', 'phone_numbers');

-- GildOps' own dogfood Plan carried two allowances whose own description says metering is left
-- on, classified as `capacity` with `metered` overage and no meter at all -- an allowance that
-- claims to meter overage and names nothing that measures it. `voice_minutes` is a usage
-- allowance over the meter of the same name; `ai_tokens` spans two meters (input and output) and
-- an allowance names at most one, so it is honestly unmetered rather than pointed at half of
-- itself.
update public.platform_plan_quotas q
   set allowance_type = 'usage', meter_id = 'voice_minutes'
  from public.platform_plans p
 where p.id = q.plan_id and p.key = 'gold_internal' and q.allowance_key = 'voice_minutes';

update public.platform_plan_quotas q
   set overage_behavior = 'unmetered'
  from public.platform_plans p
 where p.id = q.plan_id and p.key = 'gold_internal' and q.allowance_key = 'ai_tokens';

-- ---------------------------------------------------------------------------
-- 2. Which allowances the platform can actually count
-- ---------------------------------------------------------------------------
-- A usage allowance counts `usage_events`, which is the one ledger that already records
-- consumption (D65). Everything else needs a real resource model to count, and most of them do
-- not have one yet. **An allowance with no counter must say so rather than report zero**: zero
-- consumed and "nothing counts this" are two facts, and the second one wearing the first is how
-- a limit looks enforced while nothing enforces it (the same reasoning that made
-- `usage_events.customer_charge_micros` nullable).
--
-- A row here, not a branch in a function: which allowance a counter answers is catalogue data an
-- operator can see, and a counter with no row cannot be reached. The closed set of
-- implementations is the branch -- `app.check_custom_fields`' six kinds, one axis over.
create table public.platform_allowance_counters (
  allowance_key    text primary key check (allowance_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  counter_key      text not null
    check (counter_key in ('memberships', 'members_with_capability', 'active_phone_numbers')),
  counter_argument text,
  label            text not null check (length(btrim(label)) between 1 and 120),
  note             text not null default '',
  created_at       timestamptz not null default now(),

  constraint platform_allowance_counters_argument_matches_counter
    check ((counter_key = 'members_with_capability') = (counter_argument is not null))
);

comment on table public.platform_allowance_counters is
  'Which non-usage allowance keys have a real runtime counter behind them, and what it counts. Platform vocabulary, migration-written. An allowance key absent here resolves its commercial definition and reports no consumption -- an honest "nothing counts this", never a zero.';

alter table public.platform_allowance_counters enable row level security;
alter table public.platform_allowance_counters force row level security;

-- Vocabulary, so readable by anybody signed in (D64) -- a tenant's own Plan screen says "3 of 5
-- users" and needs to know that number is counted rather than assumed.
create policy platform_allowance_counters_select on public.platform_allowance_counters
  for select to authenticated using (true);

grant select on public.platform_allowance_counters to authenticated;
-- No insert/update/delete grant to anyone: migration-written, like every other platform
-- vocabulary table.

insert into public.platform_allowance_counters (allowance_key, counter_key, counter_argument, label, note) values
  ('users', 'memberships', null, 'People in this business',
   'Every membership. A person invited but not yet accepted holds no membership and is not counted.'),
  ('calling_users', 'members_with_capability', 'call.place', 'People who can place calls',
   'A calling user is a member whose role may place a call -- the one definition the system already enforces, rather than a second list of who is licensed.'),
  ('phone_numbers', 'active_phone_numbers', null, 'Numbers held',
   'Numbers in this business''s inventory that are active. An inactive or quarantined number is held but not in service.');

-- `technicians` is deliberately absent. The commercial model has not bound it to anything a
-- query can count: a technician is a Resource concept, and counting Resources that represent a
-- membership would be this migration deciding what the allowance means. It resolves its
-- definition and reports no consumption until something real backs it.

-- ---------------------------------------------------------------------------
-- 3. The window an allowance is measured in
-- ---------------------------------------------------------------------------
-- `reset_semantics` has meant nothing until now. Three answers, each deterministic:
--
--   `billing_period`  the processor's own current period where one covers this moment --
--                     `organization_platform_subscriptions`, written by the platform-billing
--                     webhook, never invented here. Absent one, the Plan architecture's own
--                     anchor: the assignment's `period_start`, stepped by whole periods. That is
--                     a real date somebody chose, not "the current calendar month" wearing a
--                     billing period's name, and `basis` says which of the two answered.
--   `calendar_period` the configured day/week/month/year in the organization's own timezone.
--   `none`            no window.
--
-- `unknown` is returned when a billing period is asked for and there is neither a subscription
-- period nor an assignment to anchor to. It is unreachable from `app.allowance_states`, because
-- an allowance reaches an organization only through an assignment -- it exists so that this
-- function never invents a boundary it cannot justify.
create function app.allowance_window(
  p_organization_id uuid,
  p_reset_semantics text,
  p_period          text,
  p_at              timestamptz default now()
)
returns table (starts_at timestamptz, ends_at timestamptz, basis text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tz        text;
  v_step      interval;
  v_anchor    timestamptz;
  v_start     timestamptz;
  v_steps     bigint;
  v_sub_start timestamptz;
  v_sub_end   timestamptz;
  v_local     timestamp;
begin
  v_step := case p_period
              when 'day'   then interval '1 day'
              when 'week'  then interval '7 days'
              when 'month' then interval '1 month'
              when 'year'  then interval '1 year'
            end;

  -- A period of none, or a reset of none, is one unbounded window. Both spellings exist in the
  -- catalogue and both mean the same thing here.
  if p_reset_semantics = 'none' or v_step is null then
    return query select null::timestamptz, null::timestamptz, 'none'::text;
    return;
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_organization_id;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');

  if p_reset_semantics = 'calendar_period' then
    v_local := date_trunc(p_period, p_at at time zone v_tz);
    return query select (v_local at time zone v_tz), ((v_local + v_step) at time zone v_tz), 'calendar'::text;
    return;
  end if;

  select s.current_period_start, s.current_period_end
    into v_sub_start, v_sub_end
    from public.organization_platform_subscriptions s
   where s.organization_id = p_organization_id
     and s.current_period_start is not null
     and s.current_period_end   is not null
     and s.current_period_start <= p_at
     and s.current_period_end   >  p_at
   order by (s.environment = 'live') desc, s.current_period_start desc
   limit 1;

  if v_sub_start is not null then
    return query select v_sub_start, v_sub_end, 'subscription'::text;
    return;
  end if;

  -- The base Plan's assignment anchors it where one exists; an Add-on-only organization anchors
  -- on whichever current assignment started first, so the answer never depends on row order.
  select (a.period_start::timestamp at time zone v_tz) into v_anchor
    from public.organization_plan_assignments a
   where a.organization_id = p_organization_id
     and a.period_start <= p_at::date
     and a.period_end   >  p_at::date
   order by (a.plan_kind = 'plan') desc, a.period_start asc
   limit 1;

  if v_anchor is null then
    return query select null::timestamptz, null::timestamptz, 'unknown'::text;
    return;
  end if;

  -- The first period, for the hours of day one that fall before the anchor's own local midnight.
  if p_at < v_anchor then
    return query select v_anchor, v_anchor + v_step, 'assignment'::text;
    return;
  end if;

  -- Jump by arithmetic, then correct by at most one step: a month is not a fixed number of
  -- seconds and a day is not always 24 hours, so neither can be divided out exactly.
  if p_period in ('day', 'week') then
    v_steps := floor(extract(epoch from (p_at - v_anchor)) / extract(epoch from v_step));
  elsif p_period = 'month' then
    v_steps := (extract(year  from (p_at at time zone v_tz))::bigint
                - extract(year  from (v_anchor at time zone v_tz))::bigint) * 12
             + (extract(month from (p_at at time zone v_tz))::bigint
                - extract(month from (v_anchor at time zone v_tz))::bigint);
  else
    v_steps := extract(year from (p_at at time zone v_tz))::bigint
             - extract(year from (v_anchor at time zone v_tz))::bigint;
  end if;

  v_start := v_anchor + (greatest(v_steps, 0) * v_step);
  while v_start > p_at loop v_start := v_start - v_step; end loop;
  while v_start + v_step <= p_at loop v_start := v_start + v_step; end loop;

  return query select v_start, v_start + v_step, 'assignment'::text;
end;
$fn$;

comment on function app.allowance_window(uuid, text, text, timestamptz) is
  'The window an allowance with these reset semantics is measured in at a moment, and which fact decided it: the processor''s subscription period, the Plan assignment''s own anchor, the organization''s calendar, no window at all, or unknown. Never invents a boundary.';

revoke all on function app.allowance_window(uuid, text, text, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- 4. What has been consumed
-- ---------------------------------------------------------------------------
-- No second consumption table, and no counter invented for an allowance that has no real one.
-- `consumed` is null exactly when nothing counts this allowance, which is a different fact from
-- nothing having been consumed.
create function app.allowance_consumption(
  p_organization_id uuid,
  p_allowance_key   text,
  p_allowance_type  text,
  p_meter_id        text,
  p_from            timestamptz,
  p_to              timestamptz
)
returns table (consumed numeric, enforcement text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_counter  text;
  v_argument text;
  v_consumed numeric;
begin
  -- A metered allowance counts the one ledger that already records consumption. A null window is
  -- an unbounded one (`reset_semantics = 'none'`), where all of it counts.
  if p_allowance_type = 'usage' and p_meter_id is not null then
    select coalesce(sum(u.quantity), 0) into v_consumed
      from public.usage_events u
     where u.organization_id = p_organization_id
       and u.meter_id = p_meter_id
       and (p_from is null or u.occurred_at >= p_from)
       and (p_to   is null or u.occurred_at <  p_to);
    return query select v_consumed, 'metered'::text;
    return;
  end if;

  select c.counter_key, c.counter_argument into v_counter, v_argument
    from public.platform_allowance_counters c
   where c.allowance_key = p_allowance_key;

  -- A count of what is in use now. A seat or a number is held at a moment, not accumulated over
  -- a window, so the window is descriptive for these and deliberately not a filter.
  if v_counter = 'memberships' then
    select count(*) into v_consumed
      from public.memberships m where m.organization_id = p_organization_id;
    return query select v_consumed, 'counted'::text;
    return;
  elsif v_counter = 'members_with_capability' then
    select count(*) into v_consumed
      from public.memberships m
      join public.roles r on r.organization_id = m.organization_id and r.id = m.role_id
     where m.organization_id = p_organization_id
       and v_argument = any (r.capabilities);
    return query select v_consumed, 'counted'::text;
    return;
  elsif v_counter = 'active_phone_numbers' then
    select count(*) into v_consumed
      from public.phone_numbers n
     where n.organization_id = p_organization_id and n.lifecycle = 'active';
    return query select v_consumed, 'counted'::text;
    return;
  end if;

  return query select null::numeric, 'unenforced'::text;
end;
$fn$;

comment on function app.allowance_consumption(uuid, text, text, text, timestamptz, timestamptz) is
  'What this organization has consumed of one allowance in one window, and how that was established: metered from usage_events, counted from a real resource model named in platform_allowance_counters, or unenforced -- which returns null rather than zero, because nothing counting it is not the same as nothing being used.';

revoke all on function app.allowance_consumption(uuid, text, text, text, timestamptz, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- 5. The resolved runtime allowance
-- ---------------------------------------------------------------------------
create function app.allowance_states(
  p_organization_id uuid,
  p_allowance_key   text default null,
  p_at              timestamptz default now()
)
returns table (
  allowance_key       text,
  label               text,
  unit                text,
  allowance_type      text,
  period              text,
  reset_semantics     text,
  window_starts_at    timestamptz,
  window_ends_at      timestamptz,
  window_basis        text,
  included            numeric,
  consumed            numeric,
  reserved            numeric,
  remaining           numeric,
  overage_quantity    numeric,
  hard_limit          numeric,
  overage_policy      text,
  overage_behavior    text,
  meter_id            text,
  service_class       text,
  contributions       jsonb,
  enforcement         text,
  state               text,
  configuration_error text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with raw as (
    select q.allowance_key, q.label, q.unit, q.allowance_type, q.period, q.reset_semantics,
           q.overage_policy, q.overage_behavior, q.meter_id, q.service_class, q.display_order,
           q.included_quantity                                as plan_default,
           o.included_quantity                                as override_included,
           coalesce(o.included_quantity, q.included_quantity) as effective_included,
           coalesce(o.hard_limit, q.hard_limit)               as effective_hard_limit,
           p.id as plan_id, p.key as plan_key, p.label as plan_label, a.plan_kind
      from public.organization_plan_assignments a
      join public.platform_plans p on p.id = a.plan_id
      join public.platform_plan_quotas q on q.plan_id = a.plan_id
      -- The latest override at or before this moment, per Plan and allowance -- the same lateral
      -- `organization_effective_quotas` already uses, so the two cannot disagree about which
      -- override is in force.
      left join lateral (
        select r.included_quantity, r.hard_limit
          from public.organization_plan_quota_overrides r
         where r.organization_id = p_organization_id
           and r.plan_id = a.plan_id
           and r.allowance_key = q.allowance_key
           and r.effective_from <= p_at
         order by r.effective_from desc
         limit 1
      ) o on true
     where a.organization_id = p_organization_id
       and a.period_start <= p_at::date
       and a.period_end   >  p_at::date
       and (p_allowance_key is null or q.allowance_key = p_allowance_key)
  ),
  grouped as (
    select r.allowance_key,
           min(r.display_order) as display_order,
           -- Every axis of semantic identity, checked rather than assumed. A quantity is not on
           -- this list, because an Add-on exists to change one.
           array_remove(array[
             case when count(distinct r.allowance_type)   > 1 then 'allowance type'  end,
             case when count(distinct r.unit)             > 1 then 'unit'            end,
             case when count(distinct r.period)           > 1 then 'period'          end,
             case when count(distinct r.reset_semantics)  > 1 then 'reset semantics' end,
             case when count(distinct r.overage_policy)   > 1 then 'overage policy'  end,
             case when count(distinct r.overage_behavior) > 1 then 'overage'         end,
             case when count(distinct coalesce(r.meter_id, ''))      > 1 then 'meter'         end,
             case when count(distinct coalesce(r.service_class, '')) > 1 then 'service class' end
           ], null) as disagreements,
           -- A differing label is cosmetic, not an identity; the base Plan's wins because
           -- `plan_kind` orders 'plan' before 'addon'.
           (array_agg(r.label order by r.plan_kind desc, r.plan_key))[1] as label,
           min(r.unit) as unit,
           min(r.allowance_type) as allowance_type,
           min(r.period) as period,
           min(r.reset_semantics) as reset_semantics,
           min(r.overage_policy) as overage_policy,
           min(r.overage_behavior) as overage_behavior,
           min(r.meter_id) as meter_id,
           min(r.service_class) as service_class,
           sum(r.effective_included) as included,
           -- A contribution with no hard limit is an unlimited one, and one unlimited
           -- contribution makes the whole allowance unlimited. Summed only when every
           -- contribution states one.
           case when count(*) filter (where r.effective_hard_limit is null) > 0
                then null else sum(r.effective_hard_limit) end as hard_limit,
           jsonb_agg(jsonb_build_object(
             'planId', r.plan_id, 'planKey', r.plan_key, 'planLabel', r.plan_label,
             'planKind', r.plan_kind,
             'planDefault', r.plan_default, 'override', r.override_included,
             'effective', r.effective_included, 'hardLimit', r.effective_hard_limit,
             'overridden', r.override_included is not null,
             'allowanceType', r.allowance_type, 'unit', r.unit, 'period', r.period,
             'resetSemantics', r.reset_semantics, 'overageBehavior', r.overage_behavior,
             'meterId', r.meter_id, 'serviceClass', r.service_class
           ) order by r.plan_kind desc, r.plan_key) as contributions
      from raw r
     group by r.allowance_key
  )
  select g.allowance_key, g.label, g.unit, g.allowance_type, g.period, g.reset_semantics,
         w.starts_at, w.ends_at, w.basis,
         case when cardinality(g.disagreements) > 0 then null else g.included end,
         c.consumed,
         -- No reservation model exists: an in-flight operation is serialized by the lock
         -- `app.record_usage` takes rather than by holding units aside. Zero, and said so.
         0::numeric,
         case when cardinality(g.disagreements) > 0 or c.consumed is null then null
              else g.included - c.consumed end,
         case when cardinality(g.disagreements) > 0 or c.consumed is null then 0::numeric
              else greatest(c.consumed - g.included, 0) end,
         g.hard_limit, g.overage_policy, g.overage_behavior, g.meter_id, g.service_class,
         g.contributions, c.enforcement,
         case
           when cardinality(g.disagreements) > 0 then 'configuration_error'
           when c.consumed is null then 'available'
           when g.hard_limit is not null and c.consumed >= g.hard_limit then 'hard_limit'
           when g.overage_behavior = 'hard_limit' and c.consumed >= g.included then 'hard_limit'
           when g.overage_behavior = 'soft_limit' and c.consumed >= g.included then 'soft_limit'
           else 'available'
         end,
         case when cardinality(g.disagreements) > 0
              then 'The Plans contributing this allowance disagree on its '
                   || array_to_string(g.disagreements, ', ') || '.'
         end
    from grouped g
    cross join lateral app.allowance_window(p_organization_id, g.reset_semantics, g.period, p_at) w
    cross join lateral app.allowance_consumption(
      p_organization_id, g.allowance_key, g.allowance_type, g.meter_id, w.starts_at, w.ends_at) c
   order by g.display_order, g.allowance_key;
$fn$;

comment on function app.allowance_states(uuid, text, timestamptz) is
  'What this organization is allowed to consume right now, one row per allowance key: every contributing Plan and Add-on composed, the window resolved, consumption counted, and the state it is in. The one runtime answer -- callers read it, never rebuild it.';

revoke all on function app.allowance_states(uuid, text, timestamptz) from public;

-- The public door: a parameter the caller chose is no scope (D17), so this proves membership or
-- platform staff itself and calls an `app` core that holds no grant.
create function public.organization_allowance_state(
  p_organization_id uuid,
  p_allowance_key   text default null,
  p_at              timestamptz default now()
)
returns table (
  allowance_key       text,
  label               text,
  unit                text,
  allowance_type      text,
  period              text,
  reset_semantics     text,
  window_starts_at    timestamptz,
  window_ends_at      timestamptz,
  window_basis        text,
  included            numeric,
  consumed            numeric,
  reserved            numeric,
  remaining           numeric,
  overage_quantity    numeric,
  hard_limit          numeric,
  overage_policy      text,
  overage_behavior    text,
  meter_id            text,
  service_class       text,
  contributions       jsonb,
  enforcement         text,
  state               text,
  configuration_error text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or app.is_platform_staff()) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_states(p_organization_id, p_allowance_key, p_at);
end;
$fn$;

comment on function public.organization_allowance_state(uuid, text, timestamptz) is
  'A member''s or staff''s read of app.allowance_states. Nothing about GildOps'' own provider cost or margin passes through it: it reads the quantity side only.';

revoke all on function public.organization_allowance_state(uuid, text, timestamptz) from public;
grant execute on function public.organization_allowance_state(uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The one enforcement decision
-- ---------------------------------------------------------------------------
-- One contract every runtime consumer asks, so that `if used >= limit` is never written again in
-- Communications, AI, Automations or Field.
--
-- Three results permit the operation (`allowed`, `allowed_with_overage`, `soft_limit_warning`)
-- and three refuse it (`hard_limit_reached`, `not_entitled`, `configuration_error`). `permitted`
-- is returned alongside `result` so a caller cannot get that mapping wrong -- and
-- `configuration_error` permits, deliberately: a disagreement between GildOps' own Plans must
-- not stop a business working, and the staff screen is where it is reported.
--
-- **An allowance key with no contribution is not a refusal.** Several Plans deliberately carry
-- no quota row for a capability they entitle (20261015000002's own header says so), so absence
-- means no allowance governs this -- `governed` is false and the answer is `allowed`. Entitlement
-- is a separate plane and stays `app.check_module_entitlement`'s question (D25); `not_entitled`
-- here means only that the package states this allowance and includes none of it.
create function app.allowance_decision(
  p_organization_id   uuid,
  p_allowance_key     text,
  p_requested_quantity numeric default 1,
  p_at                timestamptz default now()
)
returns table (
  result            text,
  permitted         boolean,
  governed          boolean,
  allowance_key     text,
  label             text,
  unit              text,
  included          numeric,
  consumed          numeric,
  remaining         numeric,
  included_applied  numeric,
  overage_applied   numeric,
  hard_limit        numeric,
  overage_behavior  text,
  enforcement       text,
  window_starts_at  timestamptz,
  window_ends_at    timestamptz,
  window_basis      text,
  detail            text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  s        record;
  v_asked  numeric := greatest(coalesce(p_requested_quantity, 0), 0);
  v_free   numeric;
  v_inc    numeric;
  v_over   numeric;
  v_result text;
  v_detail text;
begin
  select * into s from app.allowance_states(p_organization_id, p_allowance_key, p_at) limit 1;

  if not found then
    return query select 'allowed'::text, true, false, p_allowance_key, null::text, null::text,
      null::numeric, null::numeric, null::numeric, 0::numeric, v_asked, null::numeric,
      null::text, 'ungoverned'::text, null::timestamptz, null::timestamptz, null::text,
      'No allowance in this package governs this.'::text;
    return;
  end if;

  if s.state = 'configuration_error' then
    return query select 'configuration_error'::text, true, true, s.allowance_key, s.label, s.unit,
      null::numeric, s.consumed, null::numeric, 0::numeric, v_asked, s.hard_limit,
      s.overage_behavior, s.enforcement, s.window_starts_at, s.window_ends_at, s.window_basis,
      s.configuration_error;
    return;
  end if;

  -- A boolean allowance the package states and includes none of: this is what the package says
  -- the business does not have.
  if s.allowance_type = 'boolean' and s.included = 0 then
    return query select 'not_entitled'::text, false, true, s.allowance_key, s.label, s.unit,
      s.included, s.consumed, s.remaining, 0::numeric, v_asked, s.hard_limit,
      s.overage_behavior, s.enforcement, s.window_starts_at, s.window_ends_at, s.window_basis,
      format('This package does not include %s.', lower(s.label));
    return;
  end if;

  -- Nothing counts this allowance, so nothing can be said to have been used up.
  if s.consumed is null then
    return query select 'allowed'::text, true, true, s.allowance_key, s.label, s.unit,
      s.included, null::numeric, null::numeric, null::numeric, null::numeric, s.hard_limit,
      s.overage_behavior, s.enforcement, s.window_starts_at, s.window_ends_at, s.window_basis,
      'This allowance has no runtime counter, so consumption is not tracked.'::text;
    return;
  end if;

  v_free := greatest(s.included - s.consumed, 0);
  v_inc  := least(v_free, v_asked);
  v_over := v_asked - v_inc;

  if s.hard_limit is not null and s.consumed + v_asked > s.hard_limit then
    v_result := 'hard_limit_reached';
    v_detail := format('This would pass the hard limit of %s %s.', s.hard_limit, lower(s.label));
  elsif v_over = 0 then
    v_result := 'allowed';
    v_detail := null;
  elsif s.overage_behavior = 'hard_limit' or s.overage_policy = 'blocked' then
    v_result := 'hard_limit_reached';
    v_detail := format('All %s included %s are used, and this package does not allow more.', s.included, lower(s.label));
  elsif s.overage_behavior = 'soft_limit' then
    v_result := 'soft_limit_warning';
    v_detail := format('Past the %s %s this package includes.', s.included, lower(s.label));
  elsif s.overage_behavior in ('unmetered', 'not_applicable') then
    v_result := 'allowed_with_overage';
    v_detail := format('Past the %s %s this package includes; this allowance does not meter overage.', s.included, lower(s.label));
  else
    v_result := 'allowed_with_overage';
    v_detail := null;
  end if;

  return query select v_result, v_result <> 'hard_limit_reached', true,
    s.allowance_key, s.label, s.unit, s.included, s.consumed, s.remaining,
    v_inc, v_over, s.hard_limit, s.overage_behavior, s.enforcement,
    s.window_starts_at, s.window_ends_at, s.window_basis, v_detail;
end;
$fn$;

comment on function app.allowance_decision(uuid, text, numeric, timestamptz) is
  'Whether this organization may consume this much of one allowance right now, with enough provenance to explain the answer. The one API a runtime consumer asks; three results permit and three refuse, and `permitted` carries that mapping so no caller re-derives it.';

revoke all on function app.allowance_decision(uuid, text, numeric, timestamptz) from public;

-- Which allowance governs a meter, for the consumers that know a meter and not an allowance key.
-- At most one may; two naming the same meter is a catalogue mistake the state resolver already
-- reports, and this leaves the usage ungoverned rather than silently picking one of them.
create function app.allowance_key_for_meter(
  p_organization_id uuid,
  p_meter_id        text,
  p_at              timestamptz default now()
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case when count(*) = 1 then min(s.allowance_key) end
    from app.allowance_states(p_organization_id, null, p_at) s
   where s.meter_id = p_meter_id and s.allowance_type = 'usage';
$fn$;

revoke all on function app.allowance_key_for_meter(uuid, text, timestamptz) from public;

create function app.allowance_decision_for_meter(
  p_organization_id    uuid,
  p_meter_id           text,
  p_requested_quantity numeric default 1,
  p_at                 timestamptz default now()
)
returns table (
  result            text,
  permitted         boolean,
  governed          boolean,
  allowance_key     text,
  label             text,
  unit              text,
  included          numeric,
  consumed          numeric,
  remaining         numeric,
  included_applied  numeric,
  overage_applied   numeric,
  hard_limit        numeric,
  overage_behavior  text,
  enforcement       text,
  window_starts_at  timestamptz,
  window_ends_at    timestamptz,
  window_basis      text,
  detail            text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select * from app.allowance_decision(
    p_organization_id,
    app.allowance_key_for_meter(p_organization_id, p_meter_id, p_at),
    p_requested_quantity, p_at);
$fn$;

revoke all on function app.allowance_decision_for_meter(uuid, text, numeric, timestamptz) from public;

-- The public door, same scope check as the state reader above. What a screen asks to say
-- "the next 30 minutes are included" before somebody presses anything.
create function public.allowance_decision(
  p_organization_id    uuid,
  p_allowance_key      text,
  p_requested_quantity numeric default 1,
  p_at                 timestamptz default now()
)
returns table (
  result            text,
  permitted         boolean,
  governed          boolean,
  allowance_key     text,
  label             text,
  unit              text,
  included          numeric,
  consumed          numeric,
  remaining         numeric,
  included_applied  numeric,
  overage_applied   numeric,
  hard_limit        numeric,
  overage_behavior  text,
  enforcement       text,
  window_starts_at  timestamptz,
  window_ends_at    timestamptz,
  window_basis      text,
  detail            text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or app.is_platform_staff()) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_decision(
    p_organization_id, p_allowance_key, p_requested_quantity, p_at);
end;
$fn$;

revoke all on function public.allowance_decision(uuid, text, numeric, timestamptz) from public;
grant execute on function public.allowance_decision(uuid, text, numeric, timestamptz) to authenticated;
