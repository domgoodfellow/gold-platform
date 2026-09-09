-- A reconciliation corrects what a reading is believed to have cost GOLD. It must never become
-- a second reading -- `organization_commercial_summary` sums `usage_events` by row, and a second
-- row for the same call would double the quantity and the customer charge alongside the cost it
-- meant to fix.
--
-- **The shape.** `usage_events` stays the immutable usage fact (D43, corrected by the previous
-- two migrations). `usage_cost_reconciliations` is a second, append-only table keyed to one
-- usage event, carrying only what a reconciliation actually learns: GOLD's real cost, in the
-- provider's own currency, and where that number came from. It adds no quantity and no customer
-- charge -- both stay exactly where they already are, on the one row a reading ever gets.

-- I18: a reference between two tenant-owned tables is composite. `usage_events` never needed
-- this index before because nothing referenced it.
create unique index usage_events_org_id_unique on public.usage_events (organization_id, id);

create table public.usage_cost_reconciliations (
  id                             uuid        primary key default gen_random_uuid(),
  organization_id                uuid        not null references public.organizations (id) on delete cascade,
  usage_event_id                 uuid        not null,

  reconciled_provider_cost_micros bigint     not null check (reconciled_provider_cost_micros >= 0),
  provider_currency              text        not null check (provider_currency ~ '^[A-Z]{3}$'),
  provider_reference             text        not null default '',

  source                         text        not null check (length(btrim(source)) between 1 and 200),
  reconciled_at                  timestamptz not null default now(),
  recorded_by                    uuid        references auth.users (id),
  note                           text        not null default '',

  constraint usage_cost_reconciliations_event_same_org
    foreign key (organization_id, usage_event_id)
    references public.usage_events (organization_id, id) on delete cascade
);

comment on table public.usage_cost_reconciliations is
  'A correction to what one usage_events row actually cost GOLD, once a provider''s real bill is known. Append-only -- multiple rows for one event are corrections in turn, and the latest by reconciled_at is the effective one. Carries no quantity and no customer charge, so it can never duplicate either.';

-- I2: leads with organization_id, even though the natural key for "which event" is
-- usage_event_id alone -- the composite reference above is what makes that safe (I18).
create index usage_cost_reconciliations_org_event_idx
  on public.usage_cost_reconciliations (organization_id, usage_event_id, reconciled_at desc);

alter table public.usage_cost_reconciliations enable row level security;
alter table public.usage_cost_reconciliations force row level security;

-- Staff only, like the estimate's own withheld columns (I29) -- a reconciled cost is GOLD's cost
-- exactly as much as the estimate it corrects.
create policy usage_cost_reconciliations_platform_select on public.usage_cost_reconciliations
  for select to platform_staff using (true);

grant select on public.usage_cost_reconciliations to platform_staff;
-- No grant to authenticated at all. No insert/update/delete grant to anyone -- the one door is
-- below.

-- ---------------------------------------------------------------------------
-- The one door -- built for the provider-sync job the next slice adds, staffed by a person
-- until then
-- ---------------------------------------------------------------------------

-- **Who may call this today.** There is no machine role yet for a provider-sync job -- that
-- axis arrives with provider bindings, the next slice, the same way `payment_webhook` arrived
-- only once there was a webhook to receive. Until then this is staff-only, the exact shape
-- `record_provider_rate` already uses, so a person can record what a vendor's invoice said. The
-- next slice widens the grant to a machine role; it does not need to change this function's
-- body to do it.
create function public.record_usage_reconciliation(
  p_usage_event_id                  uuid,
  p_reconciled_provider_cost_micros bigint,
  p_provider_currency               text,
  p_source                          text,
  p_provider_reference              text default '',
  p_note                             text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_org   uuid;
  v_id    uuid;
begin
  perform app.require_platform_staff();

  select u.organization_id into v_org
    from public.usage_events u
   where u.id = p_usage_event_id;

  if v_org is null then
    raise exception 'no such usage event' using errcode = '23503';
  end if;

  insert into public.usage_cost_reconciliations
    (organization_id, usage_event_id, reconciled_provider_cost_micros, provider_currency,
     provider_reference, source, recorded_by, note)
  values
    (v_org, p_usage_event_id, p_reconciled_provider_cost_micros, upper(btrim(p_provider_currency)),
     p_provider_reference, p_source, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_usage_reconciliation(uuid, bigint, text, text, text, text) is
  'The one door onto usage_cost_reconciliations. Adds no quantity and no customer charge, so it can never duplicate either -- only what a usage event actually cost GOLD, corrected. Staff-only for now; a machine role for the provider-sync job is the next slice''s to add.';

revoke all on function public.record_usage_reconciliation(uuid, bigint, text, text, text, text) from public;
grant execute on function public.record_usage_reconciliation(uuid, bigint, text, text, text, text) to platform_staff;

-- ---------------------------------------------------------------------------
-- The estimate stays inspectable next to whatever corrected it
-- ---------------------------------------------------------------------------

-- Staff only (I29), and deliberately not the aggregate: `organization_commercial_summary` (next
-- migration) answers "what is true now"; this answers "what did we first think, and what did we
-- learn since" -- the two questions this migration exists to keep answerable separately.
create function public.organization_usage_detail(p_organization_id uuid)
returns table (
  usage_event_id            uuid,
  meter_id                  text,
  quantity                  bigint,
  occurred_at               timestamptz,
  provider_key              text,
  estimated_cost_micros     bigint,
  estimated_currency        text,
  reconciled_cost_micros    bigint,
  reconciled_currency       text,
  reconciled_at             timestamptz,
  customer_currency         text,
  customer_charge_micros    bigint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select u.id,
         u.meter_id,
         u.quantity,
         u.occurred_at,
         u.provider_key,
         u.provider_cost_micros,
         u.provider_currency,
         r.reconciled_provider_cost_micros,
         r.provider_currency,
         r.reconciled_at,
         u.customer_currency,
         u.customer_charge_micros
    from public.usage_events u
    left join lateral (
      select rec.reconciled_provider_cost_micros, rec.provider_currency, rec.reconciled_at
        from public.usage_cost_reconciliations rec
       where rec.organization_id = u.organization_id
         and rec.usage_event_id = u.id
       order by rec.reconciled_at desc
       limit 1
    ) r on true
   where u.organization_id = p_organization_id
   order by u.occurred_at desc;
$fn$;

comment on function public.organization_usage_detail(uuid) is
  'Every usage event next to its latest reconciliation, if any -- the estimate is never overwritten, so this is where it stays visible after a correction lands. security invoker over tables platform_staff already selects in full; the grant below is what withholds it from a tenant.';

revoke all on function public.organization_usage_detail(uuid) from public;
grant execute on function public.organization_usage_detail(uuid) to platform_staff;
