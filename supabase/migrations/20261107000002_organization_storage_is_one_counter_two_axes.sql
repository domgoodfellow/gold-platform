-- Work Order B, B3/B4: storage becomes a real allowance, on two axes that must never collapse
-- into one.
--
-- **The commercial axis**: how much GildOps-managed business storage this organization's package
-- includes, resolved exactly like any other capacity allowance (Work Order A's engine) — a
-- `storage_bytes` quota with no meter, no period, no reset. GildOps never promised a Supabase
-- quota; it promised an organization-storage quota, and the provider underneath it is nobody's
-- business but GildOps' own.
--
-- **The attribution seam**: what actually contributed those bytes. `app.organization_managed_storage_bytes`
-- is deliberately its own function rather than a literal `sum(documents.size_bytes)` wired
-- straight into the allowance engine, so a future Library upload, a future Knowledge ingest, or
-- a future media store can UNION into this one function without the allowance engine, the
-- enforcement door, or a single screen needing to change. `documents` is its first real
-- contributor; it is never allowed to become the *definition* of organization storage.

create function app.organization_managed_storage_bytes(p_organization_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(d.size_bytes), 0)::bigint
    from public.documents d
   where d.organization_id = p_organization_id;
  -- A future contributor adds a `union all` branch here (its own stored-object metadata, summed
  -- the same way) -- never a second function, and never a second Plan allowance.
$fn$;

comment on function app.organization_managed_storage_bytes(uuid) is
  'The one seam for "how many bytes of GildOps-managed storage does this organization hold" -- documents.size_bytes today, and where a future Library/media/knowledge contributor joins without a new allowance or a new counter. Never queried directly by the allowance engine''s own callers; go through app.allowance_consumption / app.allowance_states.';

revoke all on function app.organization_managed_storage_bytes(uuid) from public;

-- ---------------------------------------------------------------------------
-- The counter, wired into the allowance engine exactly like the three Work Order A already has
-- ---------------------------------------------------------------------------
alter table public.platform_allowance_counters drop constraint platform_allowance_counters_counter_key_check;

alter table public.platform_allowance_counters
  add constraint platform_allowance_counters_counter_key_check
    check (counter_key in ('memberships', 'members_with_capability', 'active_phone_numbers', 'organization_managed_storage'));

insert into public.platform_allowance_counters (allowance_key, counter_key, counter_argument, label, note) values
  ('storage_bytes', 'organization_managed_storage', null, 'Organization storage used',
   'Every byte GildOps manages on this organization''s behalf -- record attachments today, counted through app.organization_managed_storage_bytes so a future Library contributor joins the same count.');

create or replace function app.allowance_consumption(
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
  v_counter     text;
  v_argument    text;
  v_aggregation text;
  v_consumed    numeric;
begin
  if p_allowance_type = 'usage' and p_meter_id is not null then
    select m.aggregation into v_aggregation
      from public.platform_meters m where m.id = p_meter_id;

    select case when v_aggregation = 'high_water'
                then coalesce(max(u.quantity), 0)
                else coalesce(sum(u.quantity), 0) end
      into v_consumed
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
  elsif v_counter = 'organization_managed_storage' then
    return query select app.organization_managed_storage_bytes(p_organization_id)::numeric, 'counted'::text;
    return;
  end if;

  return query select null::numeric, 'unenforced'::text;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Seed: a real storage allowance on every production Plan, organization-scoped
-- ---------------------------------------------------------------------------
-- A capacity allowance, point-in-time (period = none, the same shape 20261105000002 already
-- corrected users/calling_users/technicians/phone_numbers to): a byte count is held, not
-- consumed per month. The hard limit equals the included quantity -- storage is allowance-based
-- by default (no automatic per-byte overage billing, per this work order's own instruction), so
-- exceeding it blocks rather than quietly accruing a charge nothing has priced.
insert into public.platform_plan_quotas
  (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy,
   meter_id, display_order, allowance_type, reset_semantics, overage_behavior)
select p.id, 'storage_bytes', 'Organization storage', 'byte', x.bytes, 'none', x.bytes, 'blocked',
       null, 6, 'capacity', 'none', 'hard_limit'
  from public.platform_plans p
  join (values
    ('start',   10 * 1000000000::numeric),
    ('operate', 50 * 1000000000::numeric),
    ('scale',  200 * 1000000000::numeric)
  ) as x(key, bytes) on p.key = x.key
on conflict (plan_id, allowance_key) do nothing;

-- GildOps' own dogfood Plan gets a generous, explicit allowance too -- storage metering stays on
-- there like everything else (20261015000002's own header, restated for a sixth allowance).
insert into public.platform_plan_quotas
  (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy,
   meter_id, display_order, allowance_type, reset_semantics, overage_behavior)
select p.id, 'storage_bytes', 'Organization storage', 'byte', 1000 * 1000000000::numeric, 'none',
       1000 * 1000000000::numeric, 'blocked', null, 4, 'capacity', 'none', 'hard_limit'
  from public.platform_plans p where p.key = 'gold_internal'
on conflict (plan_id, allowance_key) do nothing;

-- ---------------------------------------------------------------------------
-- Enforcement, at the door that writes the row -- not only in the browser
-- ---------------------------------------------------------------------------
-- Recreated in full (D15). Everything about ownership and the audit event is exactly as
-- `20260917000001` left it; the new block is the allowance check, before the insert, so an
-- organization at its storage limit cannot write a document row whatever called this function.
create or replace function public.create_document(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_location_id     uuid,
  p_asset_id        uuid,
  p_work_item_id    uuid,
  p_storage_path    text,
  p_file_name       text,
  p_mime_type       text,
  p_size_bytes      bigint
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
  d       record;
begin
  if v_actor is null then
    raise exception 'create_document requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Before the room is written, the same discipline `open_call` already holds for voice minutes:
  -- a disabled upload button is a suggestion, this is the boundary. An allowance that governs
  -- nothing (no storage quota configured) permits, exactly as every other ungoverned allowance
  -- does -- storage enforcement is opt-in per Plan, not a blanket assumption this function makes.
  --
  -- This function is `security invoker` (RLS below is the real authorization), so the door it
  -- calls has to be one the caller actually holds `execute` on -- `public.allowance_decision`,
  -- never the ungranted `app.allowance_decision` core a `security definer` caller would reach.
  select * into d from public.allowance_decision(p_organization_id, 'storage_bytes', p_size_bytes) limit 1;
  if d.result = 'hard_limit_reached' then
    raise exception 'this business has reached its storage limit: %', coalesce(d.detail, 'the included storage is used up')
      using errcode = '23514';
  end if;

  insert into public.documents
    (organization_id, customer_id, location_id, asset_id, work_item_id,
     storage_path, file_name, mime_type, size_bytes, created_by)
  values
    (p_organization_id, p_customer_id, p_location_id, p_asset_id, p_work_item_id,
     p_storage_path, p_file_name, p_mime_type, p_size_bytes, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'document', v_id, 'document.created',
     jsonb_strip_nulls(jsonb_build_object(
       'file_name', p_file_name,
       'size_bytes', p_size_bytes,
       'customer_id', p_customer_id,
       'location_id', p_location_id,
       'asset_id', p_asset_id,
       'work_item_id', p_work_item_id
     )));

  return v_id;
end;
$fn$;

comment on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) is
  'Records a stored document''s metadata once its bytes are already in the bucket. Security invoker -- the insert policy (document.create) is the authorization; this adds only the storage-allowance refusal, checked here so no caller of this door can bypass it. Refuses with 23514 when the organization is at a configured storage hard limit; an organization with no storage quota is unaffected.';
