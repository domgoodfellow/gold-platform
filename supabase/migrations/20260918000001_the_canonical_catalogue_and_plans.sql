-- The canonical Product -> Module -> Feature catalogue, and Plans/Add-ons above it.
--
-- **What this is not.** It does not touch `platform_products`, `organization_modules`,
-- `organization_commercial_terms`, `platform_meters`, `platform_provider_rates` or
-- `platform_retail_rates` in any way that changes their meaning. Every existing key, row and
-- historical fact stays exactly as readable as it was. A legacy organization with no Plan
-- assignment resolves exactly as it did before this migration -- `usable_modules` and
-- `module_commercial_state` are untouched, called by nobody new here.
--
-- **Why a new hierarchy rather than a `family_key` column on `platform_products`.** A single
-- runtime module can implement pieces of more than one canonical Product -- `reception` is both
-- Communications/Voice (inbound and outbound calling) and CRM/Sales (the pipeline and its
-- stages). A nullable column on `platform_products` can only ever say one thing about one row.
-- The runtime mapping table below is the many-to-many this actually needs: several canonical
-- Features may each point at the same legacy module key, from different Products, and nothing
-- about `platform_products` or `MODULES` changes to make that possible.
--
-- **Why three typed grant tables and not one polymorphic one.** `schema-conformance.test.ts`
-- already refuses a polymorphic `(entity_type, entity_id)` attachment outside `events` (I18) --
-- the fix this repository already uses elsewhere (the `document.created` event, this year) is
-- typed nullable columns, one per referent. `platform_plan_product_grants`,
-- `platform_plan_module_grants` and `platform_plan_feature_grants` are that same shape, one
-- table per grain, rather than one table with an entity_type discriminator.
--
-- **Why Plan assignment never writes `organization_commercial_terms`.** An earlier draft of this
-- migration had `record_plan_assignment` also insert one legacy term per included product, to
-- bridge the two systems. That would have required staff to write `organization_modules` too
-- (the "wanted" half) for the grant to do anything at all -- and D29 refuses staff reaching into
-- an organization's own operational state once it already exists. Commercial terms are the one
-- exception D29 already carves out (staff have always recorded terms for existing tenants), but
-- switching a module on is not a commercial fact, it is an operational one. So a Plan assignment
-- is its own, fully separate provenance and entitlement path: `organization_plan_assignments`
-- plus the grant tables resolve independently of `organization_commercial_terms`, and a business
-- assigned a Plan still switches its own modules on itself, exactly as D25 already requires.
--
-- **Why GOLD Internal is seeded here but not assigned to any organization here.** The Plan
-- definition is platform vocabulary (D42's own reasoning for `platform_meters`/`platform_products`,
-- applied one layer up) and belongs in a migration. Which row in `organizations` is GOLD's own is
-- deployment-specific and cannot be named by a migration that runs identically everywhere (D42) --
-- assigning the Plan to GOLD's own organization is a platform-staff action performed once through
-- the UI this migration's companion domain code adds, the same way `supabase/snippets/` has
-- always carried GOLD's own organization id rather than a migration doing it.

-- ---------------------------------------------------------------------------
-- 1. The canonical catalogue: Product -> Module -> Feature
-- ---------------------------------------------------------------------------

-- Seven, locked. The CHECK is the lock -- there is no insert door onto this table at all, ever,
-- so an eighth row can never arrive through this API regardless of who is asking.
create table public.platform_catalog_products (
  id            uuid        primary key default gen_random_uuid(),
  key           text        not null unique check (key in (
                              'crm', 'communications', 'operations', 'financial_operations',
                              'automation', 'insights', 'customer_experience'
                            )),
  label         text        not null check (length(btrim(label)) between 1 and 120),
  description   text        not null default '',
  lifecycle     text        not null default 'stable'
                              check (lifecycle in ('experimental', 'beta', 'stable', 'deprecated')),
  sale_status   text        not null default 'active'
                              check (sale_status in ('active', 'unlisted', 'archived')),
  display_order integer     not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.platform_catalog_products is
  'The seven canonical customer-facing Products (CRM, Communications, Operations, Financial '
  'Operations, Automation, Insights, Customer Experience). Locked by the key CHECK and by having '
  'no insert grant to any role, ever -- Core/Foundation and horizontal capabilities (identity, '
  'provider infrastructure, AI runtime, integrations, usage metering) are deliberately outside '
  'this set, not a gap to fill later. Distinct from platform_products (D43), which is GOLD''s '
  'flat sellable-line-item catalogue and is untouched by this migration.';

alter table public.platform_catalog_products enable row level security;
alter table public.platform_catalog_products force row level security;

create policy platform_catalog_products_select on public.platform_catalog_products
  for select to authenticated using (true);

grant select on public.platform_catalog_products to authenticated;
-- No insert/update/delete grant to anyone. update_catalog_product, below, is the only door, and
-- it can only ever change presentation columns -- key is immutable once seeded.

create table public.platform_catalog_modules (
  id            uuid        primary key default gen_random_uuid(),
  product_id    uuid        not null references public.platform_catalog_products (id) on delete cascade,
  key           text        not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label         text        not null check (length(btrim(label)) between 1 and 120),
  description   text        not null default '',
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),

  constraint platform_catalog_modules_product_key_unique unique (product_id, key)
);

comment on table public.platform_catalog_modules is
  'A coherent functional area inside one canonical Product, e.g. Communications -> Voice. Unlike '
  'the seven Products, this set is not locked -- new evidence may add a Module later.';

alter table public.platform_catalog_modules enable row level security;
alter table public.platform_catalog_modules force row level security;

create policy platform_catalog_modules_select on public.platform_catalog_modules
  for select to authenticated using (true);

grant select on public.platform_catalog_modules to authenticated;

create table public.platform_catalog_features (
  id                     uuid        primary key default gen_random_uuid(),
  module_id              uuid        not null references public.platform_catalog_modules (id) on delete cascade,
  key                    text        not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label                  text        not null check (length(btrim(label)) between 1 and 160),
  description            text        not null default '',

  -- Four independent axes (section 4). Never collapsed into one enum -- a Feature can genuinely
  -- be beta, available, an add-on and metered and AI-powered all at once.
  lifecycle              text        not null default 'stable'
                                        check (lifecycle in ('experimental', 'beta', 'stable', 'deprecated')),
  implementation_state   text        not null
                                        check (implementation_state in ('planned', 'partial', 'available')),
  packaging_default      text        not null default 'optional'
                                        check (packaging_default in ('core', 'included', 'optional', 'add_on')),
  sale_status            text        not null default 'active'
                                        check (sale_status in ('active', 'unlisted', 'archived')),

  metered                boolean     not null default false,
  ai_powered             boolean     not null default false,

  -- Advisory only, for this slice -- see the migration header. Not FK-enforced: this is
  -- metadata the catalogue carries, not a runtime gate, and every value here is staff-written
  -- seed/edit data rather than an open write surface.
  meter_ids              text[]      not null default '{}',
  provider_capabilities  text[]      not null default '{}',

  display_order          integer     not null default 0,
  created_at             timestamptz not null default now(),

  constraint platform_catalog_features_module_key_unique unique (module_id, key)
);

comment on table public.platform_catalog_features is
  'A concrete capability inside one Module. implementation_state is the one column that may '
  'never be spent to make the catalogue look more finished than the runtime is -- ''planned'' '
  'features are real rows, truthfully marked, never silently promoted to ''available''.';

alter table public.platform_catalog_features enable row level security;
alter table public.platform_catalog_features force row level security;

create policy platform_catalog_features_select on public.platform_catalog_features
  for select to authenticated using (true);

grant select on public.platform_catalog_features to authenticated;

create table public.platform_catalog_feature_dependencies (
  feature_id          uuid not null references public.platform_catalog_features (id) on delete cascade,
  requires_feature_id uuid not null references public.platform_catalog_features (id) on delete cascade,

  primary key (feature_id, requires_feature_id),
  constraint platform_catalog_feature_dependencies_not_self check (feature_id <> requires_feature_id)
);

comment on table public.platform_catalog_feature_dependencies is
  'A Feature that makes no sense without another -- AI Call Summary requires Transcription. '
  'Read-only presentation in this slice: "make dependency consequences visible" (the brief), '
  'not an enforcement mechanism.';

alter table public.platform_catalog_feature_dependencies enable row level security;
alter table public.platform_catalog_feature_dependencies force row level security;

create policy platform_catalog_feature_dependencies_select on public.platform_catalog_feature_dependencies
  for select to authenticated using (true);

grant select on public.platform_catalog_feature_dependencies to authenticated;

create table public.platform_catalog_runtime_mappings (
  id             uuid        primary key default gen_random_uuid(),
  feature_id     uuid        not null references public.platform_catalog_features (id) on delete cascade,
  mapping_kind   text        not null check (mapping_kind in ('module_key', 'product_key', 'capability_key', 'provider_key', 'kernel')),
  mapping_value  text        not null check (length(btrim(mapping_value)) between 1 and 120),
  note           text        not null default '',
  created_at     timestamptz not null default now(),

  constraint platform_catalog_runtime_mappings_unique unique (feature_id, mapping_kind, mapping_value)
);

comment on table public.platform_catalog_runtime_mappings is
  'The many-to-many seam between the canonical catalogue and what actually exists: a Feature may '
  'point at an existing MODULES key, a platform_products key, an app.has_capability key, a '
  'provider key, or "kernel" (always-on, ungated). The same module_key may be the target of '
  'several Features across different Products -- reception backs both Communications/Voice and '
  'CRM/Sales features, and this table is what makes that expressible without touching either '
  'existing system.';

alter table public.platform_catalog_runtime_mappings enable row level security;
alter table public.platform_catalog_runtime_mappings force row level security;

create policy platform_catalog_runtime_mappings_select on public.platform_catalog_runtime_mappings
  for select to authenticated using (true);

grant select on public.platform_catalog_runtime_mappings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Plans and Add-ons
-- ---------------------------------------------------------------------------

create table public.platform_plans (
  id            uuid        primary key default gen_random_uuid(),
  key           text        not null unique check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  kind          text        not null check (kind in ('plan', 'addon')),
  label         text        not null check (length(btrim(label)) between 1 and 120),
  description   text        not null default '',
  billable      boolean     not null default true,
  sale_status   text        not null default 'active'
                              check (sale_status in ('active', 'unlisted', 'archived')),
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid        not null references auth.users (id)
);

comment on table public.platform_plans is
  'Reusable packaging above organization-specific terms. A Plan is exclusive per organization at '
  'a time (see organization_plan_assignments); an Add-on stacks freely alongside a Plan and '
  'other Add-ons. billable = false is how GOLD Internal stays free while metering stays on -- '
  'metering is organization_modules/usage_events, wholly unrelated to this table.';

alter table public.platform_plans enable row level security;
alter table public.platform_plans force row level security;

create policy platform_plans_select on public.platform_plans
  for select to authenticated using (true);

grant select on public.platform_plans to authenticated;

create table public.platform_plan_product_grants (
  plan_id        uuid        not null references public.platform_plans (id) on delete cascade,
  product_id     uuid        not null references public.platform_catalog_products (id) on delete cascade,
  granted_scope  text        not null default 'all_available'
                               check (granted_scope in ('all_available')),
  created_at     timestamptz not null default now(),

  primary key (plan_id, product_id)
);

comment on table public.platform_plan_product_grants is
  'A whole-Product grant: every Feature under this Product whose implementation_state is '
  '''available'', evaluated live at resolution time -- never ''planned'' or ''partial'' Features, '
  'so selecting a Product never silently promises something that does not exist yet (section 18: '
  '"do not automatically include planned Features merely because a parent Product is selected"). '
  'A Feature-level override in platform_plan_feature_grants always wins over this.';

alter table public.platform_plan_product_grants enable row level security;
alter table public.platform_plan_product_grants force row level security;

create policy platform_plan_product_grants_select on public.platform_plan_product_grants
  for select to authenticated using (true);

grant select on public.platform_plan_product_grants to authenticated;

create table public.platform_plan_module_grants (
  plan_id        uuid        not null references public.platform_plans (id) on delete cascade,
  module_id      uuid        not null references public.platform_catalog_modules (id) on delete cascade,
  granted_scope  text        not null default 'all_available'
                               check (granted_scope in ('all_available')),
  created_at     timestamptz not null default now(),

  primary key (plan_id, module_id)
);

comment on table public.platform_plan_module_grants is
  'The same idea as platform_plan_product_grants, one level down -- grant every currently '
  'available Feature under one Module without granting the rest of its Product.';

alter table public.platform_plan_module_grants enable row level security;
alter table public.platform_plan_module_grants force row level security;

create policy platform_plan_module_grants_select on public.platform_plan_module_grants
  for select to authenticated using (true);

grant select on public.platform_plan_module_grants to authenticated;

create table public.platform_plan_feature_grants (
  plan_id     uuid        not null references public.platform_plans (id) on delete cascade,
  feature_id  uuid        not null references public.platform_catalog_features (id) on delete cascade,
  included    boolean     not null,
  created_at  timestamptz not null default now(),

  primary key (plan_id, feature_id)
);

comment on table public.platform_plan_feature_grants is
  'An explicit Feature-level override, in either direction: included = true adds a Feature a '
  'Product/Module grant would not otherwise cover (an add-on Feature such as AI Call Summary); '
  'included = false excludes one a covering Product/Module grant would otherwise include. Always '
  'takes precedence over platform_plan_product_grants and platform_plan_module_grants.';

alter table public.platform_plan_feature_grants enable row level security;
alter table public.platform_plan_feature_grants force row level security;

create policy platform_plan_feature_grants_select on public.platform_plan_feature_grants
  for select to authenticated using (true);

grant select on public.platform_plan_feature_grants to authenticated;

create table public.platform_plan_quotas (
  id                 uuid        primary key default gen_random_uuid(),
  plan_id            uuid        not null references public.platform_plans (id) on delete cascade,
  allowance_key      text        not null check (allowance_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label              text        not null check (length(btrim(label)) between 1 and 120),
  unit               text        not null check (length(btrim(unit)) between 1 and 40),
  included_quantity  numeric     not null check (included_quantity >= 0),
  period             text        not null default 'month'
                                    check (period in ('day', 'week', 'month', 'year', 'none')),
  hard_limit         numeric     check (hard_limit is null or hard_limit >= included_quantity),
  overage_policy     text        not null default 'not_applicable'
                                    check (overage_policy in ('allowed', 'blocked', 'not_applicable')),
  service_class      text,
  meter_id           text        references public.platform_meters (id),
  display_order      integer     not null default 0,
  created_at         timestamptz not null default now(),

  constraint platform_plan_quotas_unique unique (plan_id, allowance_key)
);

comment on table public.platform_plan_quotas is
  'Structured allowances (section 8) -- never a free-text note requiring runtime parsing. '
  'allowance_key is not required to be a platform_meters id: some allowances (seats, users) have '
  'no meter behind them at all, which is why meter_id is nullable. Runtime enforcement is out of '
  'scope for this slice; these rows exist so a later slice can read them directly.';

alter table public.platform_plan_quotas enable row level security;
alter table public.platform_plan_quotas force row level security;

create policy platform_plan_quotas_select on public.platform_plan_quotas
  for select to authenticated using (true);

grant select on public.platform_plan_quotas to authenticated;

create table public.platform_plan_prices (
  id               uuid        primary key default gen_random_uuid(),
  plan_id          uuid        not null references public.platform_plans (id) on delete cascade,
  currency         text        not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor     bigint      not null check (amount_minor >= 0),
  billing_interval text        not null check (billing_interval in ('month', 'year', 'one_time')),
  effective_from   timestamptz not null default now(),
  approval_state   text        not null default 'approved' check (approval_state in ('draft', 'approved')),
  source           text        not null default '' ,
  source_url       text,
  captured_at      timestamptz not null default now(),
  recorded_by      uuid        not null references auth.users (id),
  note             text        not null default '',

  constraint platform_plan_prices_unique_moment unique (plan_id, currency, effective_from)
);

comment on table public.platform_plan_prices is
  'A Plan''s own standard recurring price, append-only and effective-dated -- never the sum of '
  'what its included Features would cost standalone (section 9). Carries the same provenance '
  'shape as platform_product_prices/platform_provider_rates (source/source_url/captured_at) so a '
  'future rate-import job has somewhere to land without a schema change.';

alter table public.platform_plan_prices enable row level security;
alter table public.platform_plan_prices force row level security;

create policy platform_plan_prices_select on public.platform_plan_prices
  for select to authenticated using (true);

grant select on public.platform_plan_prices to authenticated;
-- No insert/update/delete grant to anyone -- record_plan_price, below, is the only door, and it
-- can only ever insert a new row: no update/delete grant exists, so a historical price can never
-- be rewritten (I8, restated for GOLD's own price list).

-- ---------------------------------------------------------------------------
-- 3. Organization Plan assignment, agreement and quota override -- provenance,
--    entirely separate from organization_commercial_terms (see migration header)
-- ---------------------------------------------------------------------------

create table public.organization_plan_assignments (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  plan_id         uuid        not null references public.platform_plans (id),
  -- Snapshotted (I8) so the exclusion constraint below can apply only to base Plans without a
  -- join back to platform_plans, whose own kind could in principle change later.
  plan_kind       text        not null check (plan_kind in ('plan', 'addon')),
  period_start    date        not null,
  period_end      date        not null,
  assigned_by     uuid        not null references auth.users (id),
  assigned_at     timestamptz not null default now(),
  note            text        not null default '',

  constraint organization_plan_assignments_period_ordered check (period_end > period_start),

  -- Only base Plans exclude each other on overlap -- an organization has at most one base Plan
  -- at a time, but any number of Add-ons may stack alongside it and alongside each other.
  constraint organization_plan_assignments_one_base_plan
    exclude using gist (
      organization_id with =,
      daterange(period_start, period_end) with &&
    ) where (plan_kind = 'plan')
);

comment on table public.organization_plan_assignments is
  'Which Plan/Add-on package an organization has, for a period -- provenance and the entitlement '
  'source for the canonical catalogue. Deliberately does not touch organization_modules or '
  'organization_commercial_terms: assigning a Plan pays for nothing and switches nothing on by '
  'itself (see migration header). Append-only, like organization_commercial_terms.';

create index organization_plan_assignments_org_idx
  on public.organization_plan_assignments (organization_id, period_start desc);

alter table public.organization_plan_assignments enable row level security;
alter table public.organization_plan_assignments force row level security;

create policy organization_plan_assignments_select on public.organization_plan_assignments
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_plan_assignments to authenticated;
-- No insert/update/delete grant to anyone -- record_plan_assignment, below, is the only door.

create table public.organization_plan_agreements (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  plan_id         uuid        not null references public.platform_plans (id),
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor    bigint      not null check (amount_minor >= 0),
  effective_from  timestamptz not null default now(),
  recorded_by     uuid        not null references auth.users (id),
  recorded_at     timestamptz not null default now(),
  note            text        not null default '',

  constraint organization_plan_agreements_unique_moment unique (organization_id, plan_id, effective_from)
);

comment on table public.organization_plan_agreements is
  'A negotiated price for one organization on one Plan, overriding platform_plan_prices'' '
  'standard amount from effective_from onward -- append-only, so changing NextFund''s agreed '
  'price never rewrites what it agreed to before (section 9). "Current" is the latest row at or '
  'before a moment, exactly like platform_plan_prices; absent, the standard price applies.';

create index organization_plan_agreements_org_plan_idx
  on public.organization_plan_agreements (organization_id, plan_id, effective_from desc);

alter table public.organization_plan_agreements enable row level security;
alter table public.organization_plan_agreements force row level security;

create policy organization_plan_agreements_select on public.organization_plan_agreements
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_plan_agreements to authenticated;
-- No insert/update/delete grant to anyone -- record_plan_agreement, below, is the only door.

create table public.organization_plan_quota_overrides (
  id                 uuid        primary key default gen_random_uuid(),
  organization_id    uuid        not null references public.organizations (id) on delete cascade,
  plan_id            uuid        not null references public.platform_plans (id),
  allowance_key      text        not null check (allowance_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  included_quantity  numeric     not null check (included_quantity >= 0),
  hard_limit         numeric     check (hard_limit is null or hard_limit >= included_quantity),
  effective_from     timestamptz not null default now(),
  recorded_by        uuid        not null references auth.users (id),
  recorded_at        timestamptz not null default now(),
  note               text        not null default '',

  constraint organization_plan_quota_overrides_unique_moment
    unique (organization_id, plan_id, allowance_key, effective_from)
);

comment on table public.organization_plan_quota_overrides is
  'One organization''s override of a Plan''s standard quota -- append-only, "current" is the '
  'latest row at or before a moment. Absent, the Plan''s own platform_plan_quotas row applies.';

alter table public.organization_plan_quota_overrides enable row level security;
alter table public.organization_plan_quota_overrides force row level security;

create policy organization_plan_quota_overrides_select on public.organization_plan_quota_overrides
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_plan_quota_overrides to authenticated;
-- No insert/update/delete grant to anyone -- record_plan_quota_override, below, is the only door.

-- ---------------------------------------------------------------------------
-- 4. Staff-only writes -- narrow doors, following app.require_platform_staff() (D45)
-- ---------------------------------------------------------------------------

create function public.update_catalog_product(
  p_key           text,
  p_label         text,
  p_description   text,
  p_lifecycle     text,
  p_sale_status   text,
  p_display_order integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  update public.platform_catalog_products
     set label = p_label,
         description = p_description,
         lifecycle = p_lifecycle,
         sale_status = p_sale_status,
         display_order = p_display_order
   where key = p_key;

  if not found then
    raise exception 'no such catalog product: %', p_key using errcode = '23503';
  end if;
end;
$fn$;

comment on function public.update_catalog_product(text, text, text, text, text, integer) is
  'Presentation-only edit of a canonical Product. key is immutable -- the seven are locked.';

revoke all on function public.update_catalog_product(text, text, text, text, text, integer) from public;
grant execute on function public.update_catalog_product(text, text, text, text, text, integer) to authenticated;

create function public.update_catalog_module(
  p_module_id     uuid,
  p_label         text,
  p_description   text,
  p_display_order integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  update public.platform_catalog_modules
     set label = p_label,
         description = p_description,
         display_order = p_display_order
   where id = p_module_id;

  if not found then
    raise exception 'no such catalog module: %', p_module_id using errcode = '23503';
  end if;
end;
$fn$;

revoke all on function public.update_catalog_module(uuid, text, text, integer) from public;
grant execute on function public.update_catalog_module(uuid, text, text, integer) to authenticated;

create function public.update_catalog_feature(
  p_feature_id            uuid,
  p_label                 text,
  p_description           text,
  p_lifecycle             text,
  p_implementation_state  text,
  p_packaging_default     text,
  p_sale_status           text,
  p_metered               boolean,
  p_ai_powered            boolean,
  p_meter_ids             text[],
  p_provider_capabilities text[],
  p_display_order         integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  update public.platform_catalog_features
     set label = p_label,
         description = p_description,
         lifecycle = p_lifecycle,
         implementation_state = p_implementation_state,
         packaging_default = p_packaging_default,
         sale_status = p_sale_status,
         metered = p_metered,
         ai_powered = p_ai_powered,
         meter_ids = p_meter_ids,
         provider_capabilities = p_provider_capabilities,
         display_order = p_display_order
   where id = p_feature_id;

  if not found then
    raise exception 'no such catalog feature: %', p_feature_id using errcode = '23503';
  end if;
end;
$fn$;

comment on function public.update_catalog_feature(uuid, text, text, text, text, text, text, boolean, boolean, text[], text[], integer) is
  'The only edit door onto a Feature''s catalogue metadata. Runtime mappings are edited '
  'separately (add_runtime_mapping/remove_runtime_mapping) since they are development-owned '
  'facts about what backs a Feature, not presentation copy.';

revoke all on function public.update_catalog_feature(uuid, text, text, text, text, text, text, boolean, boolean, text[], text[], integer) from public;
grant execute on function public.update_catalog_feature(uuid, text, text, text, text, text, text, boolean, boolean, text[], text[], integer) to authenticated;

create function public.add_runtime_mapping(
  p_feature_id    uuid,
  p_mapping_kind  text,
  p_mapping_value text,
  p_note          text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform app.require_platform_staff();

  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
  values (p_feature_id, p_mapping_kind, p_mapping_value, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.add_runtime_mapping(uuid, text, text, text) from public;
grant execute on function public.add_runtime_mapping(uuid, text, text, text) to authenticated;

create function public.remove_runtime_mapping(p_mapping_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();
  delete from public.platform_catalog_runtime_mappings where id = p_mapping_id;
end;
$fn$;

revoke all on function public.remove_runtime_mapping(uuid) from public;
grant execute on function public.remove_runtime_mapping(uuid) to authenticated;

create function public.create_plan(
  p_key           text,
  p_kind          text,
  p_label         text,
  p_description   text,
  p_billable      boolean,
  p_sale_status   text,
  p_display_order integer default 0
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_staff();

  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values (p_key, p_kind, p_label, p_description, p_billable, p_sale_status, p_display_order, v_staff)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.create_plan(text, text, text, text, boolean, text, integer) from public;
grant execute on function public.create_plan(text, text, text, text, boolean, text, integer) to authenticated;

create function public.update_plan(
  p_plan_id       uuid,
  p_label         text,
  p_description   text,
  p_billable      boolean,
  p_sale_status   text,
  p_display_order integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  update public.platform_plans
     set label = p_label,
         description = p_description,
         billable = p_billable,
         sale_status = p_sale_status,
         display_order = p_display_order
   where id = p_plan_id;

  if not found then
    raise exception 'no such plan: %', p_plan_id using errcode = '23503';
  end if;
end;
$fn$;

comment on function public.update_plan(uuid, text, text, boolean, text, integer) is
  'key and kind are immutable after creation -- changing a Plan into an Add-on or vice versa '
  'would silently change what the exclusion constraint on organization_plan_assignments does '
  'for every organization already assigned it.';

revoke all on function public.update_plan(uuid, text, text, boolean, text, integer) from public;
grant execute on function public.update_plan(uuid, text, text, boolean, text, integer) to authenticated;

create function public.grant_plan_product(p_plan_id uuid, p_product_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  insert into public.platform_plan_product_grants (plan_id, product_id)
  select p_plan_id, p.id from public.platform_catalog_products p where p.key = p_product_key
  on conflict do nothing;
end;
$fn$;

revoke all on function public.grant_plan_product(uuid, text) from public;
grant execute on function public.grant_plan_product(uuid, text) to authenticated;

create function public.revoke_plan_product(p_plan_id uuid, p_product_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  delete from public.platform_plan_product_grants
   where plan_id = p_plan_id
     and product_id = (select p.id from public.platform_catalog_products p where p.key = p_product_key);
end;
$fn$;

revoke all on function public.revoke_plan_product(uuid, text) from public;
grant execute on function public.revoke_plan_product(uuid, text) to authenticated;

create function public.grant_plan_module(p_plan_id uuid, p_module_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  insert into public.platform_plan_module_grants (plan_id, module_id)
  values (p_plan_id, p_module_id)
  on conflict do nothing;
end;
$fn$;

revoke all on function public.grant_plan_module(uuid, uuid) from public;
grant execute on function public.grant_plan_module(uuid, uuid) to authenticated;

create function public.revoke_plan_module(p_plan_id uuid, p_module_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  delete from public.platform_plan_module_grants where plan_id = p_plan_id and module_id = p_module_id;
end;
$fn$;

revoke all on function public.revoke_plan_module(uuid, uuid) from public;
grant execute on function public.revoke_plan_module(uuid, uuid) to authenticated;

create function public.set_plan_feature_override(p_plan_id uuid, p_feature_id uuid, p_included boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  insert into public.platform_plan_feature_grants (plan_id, feature_id, included)
  values (p_plan_id, p_feature_id, p_included)
  on conflict (plan_id, feature_id) do update set included = excluded.included;
end;
$fn$;

revoke all on function public.set_plan_feature_override(uuid, uuid, boolean) from public;
grant execute on function public.set_plan_feature_override(uuid, uuid, boolean) to authenticated;

create function public.clear_plan_feature_override(p_plan_id uuid, p_feature_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  delete from public.platform_plan_feature_grants where plan_id = p_plan_id and feature_id = p_feature_id;
end;
$fn$;

revoke all on function public.clear_plan_feature_override(uuid, uuid) from public;
grant execute on function public.clear_plan_feature_override(uuid, uuid) to authenticated;

create function public.set_plan_quota(
  p_plan_id           uuid,
  p_allowance_key     text,
  p_label             text,
  p_unit              text,
  p_included_quantity numeric,
  p_period            text default 'month',
  p_hard_limit        numeric default null,
  p_overage_policy    text default 'not_applicable',
  p_service_class     text default null,
  p_meter_id          text default null,
  p_display_order     integer default 0
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform app.require_platform_staff();

  insert into public.platform_plan_quotas
    (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy, service_class, meter_id, display_order)
  values
    (p_plan_id, p_allowance_key, p_label, p_unit, p_included_quantity, p_period, p_hard_limit, p_overage_policy, p_service_class, p_meter_id, p_display_order)
  on conflict (plan_id, allowance_key) do update
    set label = excluded.label,
        unit = excluded.unit,
        included_quantity = excluded.included_quantity,
        period = excluded.period,
        hard_limit = excluded.hard_limit,
        overage_policy = excluded.overage_policy,
        service_class = excluded.service_class,
        meter_id = excluded.meter_id,
        display_order = excluded.display_order
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.set_plan_quota(uuid, text, text, text, numeric, text, numeric, text, text, text, integer) is
  'Upsert, deliberately -- a quota is current configuration on the Plan itself (unlike a price or '
  'an organization override, which are append-only history). Structured fields only, no prose.';

revoke all on function public.set_plan_quota(uuid, text, text, text, numeric, text, numeric, text, text, text, integer) from public;
grant execute on function public.set_plan_quota(uuid, text, text, text, numeric, text, numeric, text, text, text, integer) to authenticated;

create function public.remove_plan_quota(p_plan_id uuid, p_allowance_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();
  delete from public.platform_plan_quotas where plan_id = p_plan_id and allowance_key = p_allowance_key;
end;
$fn$;

revoke all on function public.remove_plan_quota(uuid, text) from public;
grant execute on function public.remove_plan_quota(uuid, text) to authenticated;

create function public.record_plan_price(
  p_plan_id          uuid,
  p_currency         text,
  p_amount_minor     bigint,
  p_billing_interval text,
  p_effective_from   timestamptz default now(),
  p_source           text default '',
  p_source_url       text default null,
  p_note             text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_staff();

  insert into public.platform_plan_prices
    (plan_id, currency, amount_minor, billing_interval, effective_from, source, source_url, recorded_by, note)
  values
    (p_plan_id, upper(btrim(p_currency)), p_amount_minor, p_billing_interval, p_effective_from, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.record_plan_price(uuid, text, bigint, text, timestamptz, text, text, text) from public;
grant execute on function public.record_plan_price(uuid, text, bigint, text, timestamptz, text, text, text) to authenticated;

create function public.record_plan_assignment(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_period_start    date,
  p_period_end      date,
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff    uuid := (select auth.uid());
  v_kind     text;
  v_id       uuid;
begin
  perform app.require_platform_staff();

  select kind into v_kind from public.platform_plans where id = p_plan_id;
  if v_kind is null then
    raise exception 'no such plan: %', p_plan_id using errcode = '23503';
  end if;

  insert into public.organization_plan_assignments
    (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by, note)
  values
    (p_organization_id, p_plan_id, v_kind, p_period_start, p_period_end, v_staff, p_note)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_organization_id, v_staff, 'organization', p_organization_id, 'plan_assignment.recorded',
    jsonb_build_object('assignment_id', v_id, 'plan_id', p_plan_id, 'plan_kind', v_kind,
                        'period_start', p_period_start, 'period_end', p_period_end)
  );

  return v_id;
end;
$fn$;

comment on function public.record_plan_assignment(uuid, uuid, date, date, text) is
  'Records which Plan/Add-on package an organization has for a period. Writes no row to '
  'organization_modules or organization_commercial_terms -- see the migration header for why.';

revoke all on function public.record_plan_assignment(uuid, uuid, date, date, text) from public;
grant execute on function public.record_plan_assignment(uuid, uuid, date, date, text) to authenticated;

create function public.record_plan_agreement(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_currency        text,
  p_amount_minor    bigint,
  p_effective_from  timestamptz default now(),
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_staff();

  insert into public.organization_plan_agreements
    (organization_id, plan_id, currency, amount_minor, effective_from, recorded_by, note)
  values
    (p_organization_id, p_plan_id, upper(btrim(p_currency)), p_amount_minor, p_effective_from, v_staff, p_note)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_organization_id, v_staff, 'organization', p_organization_id, 'plan_agreement.recorded',
    jsonb_build_object('agreement_id', v_id, 'plan_id', p_plan_id, 'amount_minor', p_amount_minor,
                        'currency', upper(btrim(p_currency)), 'effective_from', p_effective_from)
  );

  return v_id;
end;
$fn$;

revoke all on function public.record_plan_agreement(uuid, uuid, text, bigint, timestamptz, text) from public;
grant execute on function public.record_plan_agreement(uuid, uuid, text, bigint, timestamptz, text) to authenticated;

create function public.record_plan_quota_override(
  p_organization_id   uuid,
  p_plan_id           uuid,
  p_allowance_key     text,
  p_included_quantity numeric,
  p_hard_limit        numeric default null,
  p_effective_from    timestamptz default now(),
  p_note              text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_staff();

  insert into public.organization_plan_quota_overrides
    (organization_id, plan_id, allowance_key, included_quantity, hard_limit, effective_from, recorded_by, note)
  values
    (p_organization_id, p_plan_id, p_allowance_key, p_included_quantity, p_hard_limit, p_effective_from, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.record_plan_quota_override(uuid, uuid, text, numeric, numeric, timestamptz, text) from public;
grant execute on function public.record_plan_quota_override(uuid, uuid, text, numeric, numeric, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Resolution -- computed, never stored (I4/I5's own rule, one layer up)
-- ---------------------------------------------------------------------------

create function app.plan_grants_feature(p_plan_id uuid, p_feature_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  -- coalesce takes exactly two arguments deliberately: an explicit override is nullable (three-
  -- valued -- present-and-true, present-and-false, or absent) and must win either way once
  -- present, but a plain `exists(...)` is never null, so folding the module and product checks
  -- in as further coalesce arguments would make the first one to evaluate false win outright
  -- instead of falling through to the next -- found by the very first call this function made.
  select coalesce(
    (select g.included from public.platform_plan_feature_grants g
      where g.plan_id = p_plan_id and g.feature_id = p_feature_id),
    (
      exists (
        select 1
          from public.platform_catalog_features f
          join public.platform_plan_module_grants mg
            on mg.plan_id = p_plan_id and mg.module_id = f.module_id
         where f.id = p_feature_id and f.implementation_state = 'available'
      )
      or exists (
        select 1
          from public.platform_catalog_features f
          join public.platform_catalog_modules m on m.id = f.module_id
          join public.platform_plan_product_grants pg
            on pg.plan_id = p_plan_id and pg.product_id = m.product_id
         where f.id = p_feature_id and f.implementation_state = 'available'
      )
    )
  );
$fn$;

comment on function app.plan_grants_feature(uuid, uuid) is
  'Resolution order: an explicit Feature override always wins; otherwise a Module grant; '
  'otherwise a Product grant restricted to implementation_state = ''available''; otherwise not '
  'granted. security definer because it is called from public.organization_effective_entitlements '
  'below across tables the caller may not otherwise have a policy path to join directly.';

revoke all on function app.plan_grants_feature(uuid, uuid) from public;
-- Called from public.organization_effective_entitlements, which is security invoker (I29/I31's
-- own shape) -- authenticated needs its own execute grant to reach an app.* helper from inside an
-- invoker-rights function's body, the same requirement app.is_platform_staff() and
-- app.require_platform_staff() already carry (20260915000001).
grant execute on function app.plan_grants_feature(uuid, uuid) to authenticated;

create function public.plan_entitled_features(p_plan_id uuid)
returns table (feature_id uuid)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select f.id
    from public.platform_catalog_features f
   where app.plan_grants_feature(p_plan_id, f.id);
$fn$;

comment on function public.plan_entitled_features(uuid) is
  'Every Feature one Plan currently entitles, for rendering an entitlement tree without the '
  'client re-implementing the grant-resolution order.';

revoke all on function public.plan_entitled_features(uuid) from public;
grant execute on function public.plan_entitled_features(uuid) to authenticated;

create function public.organization_effective_entitlements(p_organization_id uuid, p_at timestamptz default now())
returns table (feature_id uuid, plan_id uuid, plan_key text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select distinct on (f.id) f.id as feature_id, a.plan_id, p.key as plan_key
    from public.organization_plan_assignments a
    join public.platform_plans p on p.id = a.plan_id
    join public.platform_catalog_features f on app.plan_grants_feature(a.plan_id, f.id)
   where a.organization_id = p_organization_id
     and a.period_start <= p_at::date
     and a.period_end   >  p_at::date
   order by f.id, a.plan_kind desc;
$fn$;

comment on function public.organization_effective_entitlements(uuid, timestamptz) is
  'Every Feature this organization''s current Plan + Add-on assignments entitle it to, unioned '
  'across all of them. security invoker: organization_plan_assignments already carries the '
  'caller''s own RLS (own organization, or staff), so this returns exactly what the caller could '
  'already see by reading that table and platform_plan_* by hand. A legacy organization with no '
  'assignment row returns no rows at all -- callers fall back to usable_modules() for those.';

revoke all on function public.organization_effective_entitlements(uuid, timestamptz) from public;
grant execute on function public.organization_effective_entitlements(uuid, timestamptz) to authenticated;

create function public.organization_plan_price(p_organization_id uuid, p_plan_id uuid, p_at timestamptz default now())
returns table (amount_minor bigint, currency text, source text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  (
    select amount_minor, currency, 'agreement'::text as source
      from public.organization_plan_agreements
     where organization_id = p_organization_id and plan_id = p_plan_id and effective_from <= p_at
     order by effective_from desc
     limit 1
  )
  union all
  (
    select amount_minor, currency, 'standard'::text as source
      from public.platform_plan_prices
     where plan_id = p_plan_id and approval_state = 'approved' and effective_from <= p_at
       and not exists (
         select 1 from public.organization_plan_agreements
          where organization_id = p_organization_id and plan_id = p_plan_id and effective_from <= p_at
       )
     order by effective_from desc
     limit 1
  );
$fn$;

comment on function public.organization_plan_price(uuid, uuid, timestamptz) is
  'The price this organization actually pays for one Plan right now: its own negotiated '
  'agreement if one is effective, else the Plan''s standard price. Never both, never summed.';

revoke all on function public.organization_plan_price(uuid, uuid, timestamptz) from public;
grant execute on function public.organization_plan_price(uuid, uuid, timestamptz) to authenticated;

create function public.organization_effective_quotas(p_organization_id uuid, p_at timestamptz default now())
returns table (
  allowance_key     text,
  label             text,
  unit              text,
  included_quantity numeric,
  hard_limit        numeric,
  period            text,
  overage_policy    text,
  service_class     text,
  meter_id          text,
  plan_key          text,
  overridden        boolean
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select q.allowance_key, q.label, q.unit,
         coalesce(o.included_quantity, q.included_quantity) as included_quantity,
         coalesce(o.hard_limit, q.hard_limit) as hard_limit,
         q.period, q.overage_policy, q.service_class, q.meter_id,
         p.key as plan_key,
         (o.included_quantity is not null) as overridden
    from public.organization_plan_assignments a
    join public.platform_plans p on p.id = a.plan_id
    join public.platform_plan_quotas q on q.plan_id = a.plan_id
    left join lateral (
      select included_quantity, hard_limit
        from public.organization_plan_quota_overrides
       where organization_id = p_organization_id and plan_id = a.plan_id and allowance_key = q.allowance_key
         and effective_from <= p_at
       order by effective_from desc
       limit 1
    ) o on true
   where a.organization_id = p_organization_id
     and a.period_start <= p_at::date
     and a.period_end   >  p_at::date
   order by q.display_order, q.allowance_key;
$fn$;

comment on function public.organization_effective_quotas(uuid, timestamptz) is
  'Every structured quota across this organization''s current Plan + Add-ons, with any '
  'organization-specific override already applied. Runtime enforcement is out of scope for this '
  'slice -- this is the read a later slice enforces against.';

revoke all on function public.organization_effective_quotas(uuid, timestamptz) from public;
grant execute on function public.organization_effective_quotas(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed: the seven Products, their Modules, a curated truthful Feature set,
--    runtime mappings, and the GOLD Internal Plan definition
-- ---------------------------------------------------------------------------

-- A system account owns the seed rows' recorded_by/created_by columns, exactly the way
-- `record_provider_rate` and friends require a real auth.users row rather than a sentinel.
-- Reuses D26's own pattern (the payment-webhook role is a real, real auth.users row with no
-- password) -- this migration creates one for platform seed data specifically, distinguishable
-- from any human staff member.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'catalogue-seed@system.gold.internal', '', now(), now(), now(), '{"provider":"system","providers":["system"]}', '{}'
where not exists (select 1 from auth.users where email = 'catalogue-seed@system.gold.internal');

do $seed$
declare
  v_seed_user uuid;

  v_crm uuid; v_comms uuid; v_ops uuid; v_finops uuid; v_auto uuid; v_insights uuid; v_cx uuid;

  v_mod uuid;
  v_feat uuid;

  v_plan_gold_internal uuid;
begin
  select id into v_seed_user from auth.users where email = 'catalogue-seed@system.gold.internal';

  -- Products -----------------------------------------------------------------
  insert into public.platform_catalog_products (key, label, description, lifecycle, display_order) values
    ('crm', 'CRM', 'Customers, contacts, the sales pipeline and how a business keeps its own list.', 'stable', 1),
    ('communications', 'Communications', 'Voice, SMS and email for reaching and hearing from customers.', 'stable', 2),
    ('operations', 'Operations', 'Work, scheduling, resources, assets and locations, and dispatch policy over them.', 'stable', 3),
    ('financial_operations', 'Financial Operations', 'What a business charges its own customers: price book, quotes, invoices, payments and job economics.', 'stable', 4),
    ('automation', 'Automation', 'Rules a business writes: when something happens, do this.', 'stable', 5),
    ('insights', 'Insights', 'Dashboards, reports, analytics and natural-language answers about the business.', 'stable', 6),
    ('customer_experience', 'Customer Experience', 'The public site, booking, the customer portal, intake forms and brand.', 'beta', 7);

  select id into v_crm from public.platform_catalog_products where key = 'crm';
  select id into v_comms from public.platform_catalog_products where key = 'communications';
  select id into v_ops from public.platform_catalog_products where key = 'operations';
  select id into v_finops from public.platform_catalog_products where key = 'financial_operations';
  select id into v_auto from public.platform_catalog_products where key = 'automation';
  select id into v_insights from public.platform_catalog_products where key = 'insights';
  select id into v_cx from public.platform_catalog_products where key = 'customer_experience';

  -- CRM ------------------------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_crm, 'customers_contacts', 'Customers & Contacts', 'Identity, ownership and activity for who a business serves.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'customer_profile', 'Customer profile', 'A customer''s own record: contact details, custom fields, history.', 'available', 'core', 1),
    (v_mod, 'contacts', 'Contacts', 'People at a customer, beyond the primary contact.', 'planned', 'included', 2),
    (v_mod, 'relationships', 'Relationships', 'How customers relate to each other (parent account, referred by).', 'planned', 'optional', 3),
    (v_mod, 'ownership_assignment', 'Ownership & assignment', 'Which member owns a customer relationship.', 'available', 'included', 4),
    (v_mod, 'tags_segmentation', 'Tags & segmentation', 'Grouping customers by tag or segment.', 'partial', 'included', 5),
    (v_mod, 'activity_timeline', 'Activity timeline', 'Every consequential event on a customer, in one place.', 'available', 'core', 6);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'ownership_assignment';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'capability_key', 'customer.manage', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'customer_profile';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'customers', 'Kernel entity -- always present, never a module switch.');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_crm, 'sales', 'Sales', 'The pipeline a customer moves through, and following up.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'pipeline', 'Sales pipeline', 'Stages a relationship moves through.', 'available', 'optional', 1),
    (v_mod, 'configurable_stages', 'Configurable stages', 'A business names its own pipeline stages.', 'available', 'optional', 2),
    (v_mod, 'qualification_state', 'Qualification', 'Marking a customer qualified/unqualified.', 'partial', 'optional', 3),
    (v_mod, 'follow_ups', 'Follow-ups', 'Scheduled follow-up reminders on a relationship.', 'planned', 'optional', 4),
    (v_mod, 'conversion_tracking', 'Conversion tracking', 'When and how a lead became a customer.', 'planned', 'optional', 5);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'pipeline';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note) values
    (v_feat, 'module_key', 'reception', 'Backed by the reception module''s customer_stages/pipeline, shared with Communications/Voice.');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'configurable_stages';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reception', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'qualification_state';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reception', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_crm, 'data', 'Data', 'Custom fields, views and bringing customer data in and out.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'custom_fields', 'Custom fields', 'A business adds its own fields to a customer record.', 'available', 'core', 1),
    (v_mod, 'configurable_views', 'Configurable views', 'Saved filters/views over the customer list.', 'partial', 'included', 2),
    (v_mod, 'csv_import', 'CSV import', 'Bring customers in from a spreadsheet.', 'available', 'optional', 3),
    (v_mod, 'csv_export', 'CSV export', 'Take customers back out.', 'planned', 'optional', 4),
    (v_mod, 'enrichment_hooks', 'Enrichment', 'Filling in gaps in a customer record from an external source.', 'planned', 'add_on', 5);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'csv_import';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'integrations', '');

  -- Communications ---------------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_comms, 'voice', 'Voice', 'Calling, routing and intelligent phone workflows.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, metered, ai_powered, meter_ids, provider_capabilities, display_order) values
    (v_mod, 'inbound_calling', 'Inbound calling', 'Receive a call from a customer.', 'available', 'included', true, false, array['voice_minutes'], array['telephony.voice'], 1),
    (v_mod, 'outbound_calling', 'Outbound calling', 'Place a call to a customer.', 'available', 'included', true, false, array['voice_minutes'], array['telephony.voice'], 2),
    (v_mod, 'browser_dialer', 'Browser dialer', 'Place and receive calls from the browser, no desk phone.', 'planned', 'included', false, false, array[]::text[], array['telephony.voice'], 3),
    (v_mod, 'call_controls', 'Call controls', 'Hold, mute, transfer while a call is live.', 'partial', 'included', false, false, array[]::text[], array[]::text[], 4),
    (v_mod, 'call_history', 'Call history', 'Every call, who was on it, how it went.', 'available', 'core', false, false, array[]::text[], array[]::text[], 5),
    (v_mod, 'number_inventory', 'Number inventory', 'The phone numbers this business has.', 'available', 'included', false, false, array[]::text[], array['telephony.number_inventory'], 6),
    (v_mod, 'caller_id', 'Caller ID / default outbound number', 'Which number a call goes out from by default.', 'available', 'included', false, false, array[]::text[], array[]::text[], 7),
    (v_mod, 'business_hours_routing', 'Business-hours routing', 'Route calls differently outside working hours.', 'planned', 'optional', false, false, array[]::text[], array[]::text[], 8),
    (v_mod, 'voicemail', 'Voicemail', 'Take a message when nobody answers.', 'planned', 'optional', false, false, array[]::text[], array[]::text[], 9),
    (v_mod, 'recording', 'Recording', 'Record a call for later review.', 'available', 'add_on', true, false, array['call_recording_minutes'], array[]::text[], 10),
    (v_mod, 'transcription', 'Transcription', 'Turn a recorded call into text.', 'planned', 'add_on', true, false, array['transcription_seconds'], array['speech.transcription'], 11),
    (v_mod, 'call_dispositions', 'Call dispositions', 'A business''s own words for how a call went.', 'available', 'included', false, false, array[]::text[], array[]::text[], 12),
    (v_mod, 'provider_health', 'Provider health', 'Whether calling infrastructure is actually working.', 'planned', 'core', false, false, array[]::text[], array[]::text[], 13),
    (v_mod, 'ai_call_summary', 'AI call summary', 'A written summary of what happened on a call.', 'planned', 'add_on', true, true, array['ai_tokens_input', 'ai_tokens_output'], array['speech.transcription', 'ai.inference'], 14),
    (v_mod, 'ai_receptionist', 'AI receptionist', 'A model answers and handles a call end to end.', 'planned', 'add_on', true, true, array['ai_tokens_input', 'ai_tokens_output'], array['ai.realtime', 'speech.synthesis'], 15);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'inbound_calling';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reception', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'outbound_calling';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reception', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'recording';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reception', 'Recording metadata exists on the conference; no organization-facing on/off switch yet.');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'call_dispositions';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reception', '');

  -- Transcription requires nothing (it is itself the input); AI Call Summary requires it.
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_comms, 'sms', 'SMS', 'Text conversations with customers.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, metered, meter_ids, provider_capabilities, display_order) values
    (v_mod, 'inbound_sms', 'Inbound messaging', 'Receive a text from a customer.', 'planned', 'included', true, array['sms_segment'], array['messaging.sms'], 1),
    (v_mod, 'outbound_sms', 'Outbound messaging', 'Send a text to a customer.', 'planned', 'included', true, array['sms_segment'], array['messaging.sms'], 2),
    (v_mod, 'sms_templates', 'Templates', 'Reusable message text.', 'planned', 'optional', false, array[]::text[], array[]::text[], 3);

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_comms, 'email', 'Email', 'Sending email on a business''s own behalf.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, metered, meter_ids, provider_capabilities, display_order) values
    (v_mod, 'sending', 'Sending', 'Send an email from the business''s own address.', 'available', 'included', true, array['email_send'], array['communications.email_delivery'], 1),
    (v_mod, 'sender_identity', 'Sender identity & domain', 'The domain email is sent from.', 'available', 'included', false, array[]::text[], array[]::text[], 2),
    (v_mod, 'email_templates', 'Templates', 'Reusable message text.', 'planned', 'optional', false, array[]::text[], array[]::text[], 3),
    (v_mod, 'delivery_events', 'Delivery events', 'Bounced, delivered, opened.', 'planned', 'optional', false, array[]::text[], array[]::text[], 4);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'sender_identity';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'provider_key', 'resend', '');

  -- Feature dependency: AI Call Summary requires Transcription.
  insert into public.platform_catalog_feature_dependencies (feature_id, requires_feature_id)
  select summary.id, transcription.id
    from public.platform_catalog_features summary
    join public.platform_catalog_features transcription
      on transcription.key = 'transcription' and transcription.module_id = summary.module_id
   where summary.key = 'ai_call_summary';

  -- Operations ---------------------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_ops, 'work_management', 'Work Management', 'Jobs, their types, statuses and what happened on them.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'work_items', 'Work items', 'A job, task or piece of work.', 'available', 'core', 1),
    (v_mod, 'work_types_statuses', 'Work types & statuses', 'A business names its own kinds of work and how they move.', 'available', 'core', 2),
    (v_mod, 'assignment', 'Assignment', 'Who or what a piece of work is assigned to.', 'available', 'core', 3),
    (v_mod, 'checklists', 'Checklists', 'A repeatable list of steps on a job.', 'available', 'included', 4),
    (v_mod, 'time_cost_capture', 'Time & cost capture', 'What a job actually took and consumed.', 'available', 'included', 5),
    (v_mod, 'work_timeline', 'Work timeline', 'Everything that happened on a job.', 'available', 'core', 6);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'work_items';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'work_items', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_ops, 'scheduling', 'Scheduling', 'The calendar, availability and resource commitment.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'calendar', 'Calendar', 'Scheduled work, by time and resource.', 'available', 'core', 1),
    (v_mod, 'availability', 'Availability', 'What time is genuinely free.', 'available', 'core', 2),
    (v_mod, 'rescheduling', 'Rescheduling & cancellation', 'Moving or cancelling scheduled work.', 'available', 'core', 3),
    (v_mod, 'scheduling_rules', 'Scheduling rules', 'Buffers and operating hours a business sets.', 'available', 'included', 4),
    (v_mod, 'capacity', 'Capacity planning', 'How much work a team can actually take on.', 'planned', 'optional', 5);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'calendar';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'scheduling', 'Scheduling is the one engine (constraints.md), not a module -- always present.');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_ops, 'resources', 'Resources', 'The people and equipment work is assigned to.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'resource_records', 'Resource records', 'A worker, vehicle or piece of equipment as a schedulable thing.', 'available', 'core', 1),
    (v_mod, 'capacity_allocation', 'Capacity & allocation', 'How much of a resource''s time is already spoken for.', 'partial', 'included', 2);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'resource_records';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'resources', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_ops, 'assets_locations', 'Assets & Locations', 'Where work happens and what it is done to.', 4)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'locations', 'Locations', 'Customer and business locations.', 'available', 'core', 1),
    (v_mod, 'assets', 'Assets', 'Machines, vehicles and equipment tracked over time.', 'available', 'optional', 2),
    (v_mod, 'asset_history', 'Asset history', 'What has happened to one piece of equipment.', 'available', 'included', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'locations';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'locations', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'assets';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'assets', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_ops, 'dispatch', 'Dispatch', 'Deciding who goes where, and when conditions change a plan.', 5)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'weather_aware_dispatch', 'Weather-aware dispatch', 'Move work when conditions at its location cross a threshold.', 'partial', 'optional', 1),
    (v_mod, 'geographic_routing', 'Geographic routing', 'Route planning across several jobs by location.', 'planned', 'add_on', 2);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'weather_aware_dispatch';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'weather', '');

  -- Financial Operations -------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_finops, 'pricing', 'Pricing', 'What a business charges, and the rules behind it.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'price_book', 'Price book', 'A business''s own catalogue of services and products.', 'available', 'core', 1),
    (v_mod, 'service_rates', 'Service/product rates', 'What one line of the price book costs.', 'available', 'core', 2),
    (v_mod, 'discounts', 'Discounts', 'Reducing a price by a rule.', 'planned', 'optional', 3),
    (v_mod, 'tax_configuration', 'Tax configuration', 'Applying tax to a price.', 'planned', 'optional', 4),
    (v_mod, 'customer_specific_pricing', 'Customer-specific pricing', 'A different rate for one customer.', 'planned', 'optional', 5);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'price_book';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'billing', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_finops, 'quotes_estimates', 'Quotes & Estimates', 'Pricing work before it is committed to.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'quote_creation', 'Quote creation', 'Priced lines on a job, before invoicing.', 'available', 'core', 1),
    (v_mod, 'quote_to_invoice', 'Quote to invoice', 'Turning agreed lines into an invoice.', 'available', 'core', 2),
    (v_mod, 'revisions', 'Revisions', 'Changing a quote after it was first shown.', 'planned', 'optional', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'quote_creation';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'billing', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_finops, 'invoicing', 'Invoicing', 'Billing a customer for completed and agreed work.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'invoices', 'Invoices', 'A bill sent to a customer.', 'available', 'core', 1),
    (v_mod, 'invoice_history', 'Invoice history', 'Every invoice a business has raised.', 'available', 'core', 2),
    (v_mod, 'adjustments_credits', 'Adjustments, credits & refunds', 'Correcting an invoice after the fact.', 'planned', 'optional', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'invoices';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'billing', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_finops, 'payments', 'Payments', 'Collecting what is outstanding.', 4)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, provider_capabilities, display_order) values
    (v_mod, 'connected_processor', 'Connected processor', 'A business''s own Stripe account, connected.', 'available', 'add_on', array['payments.processor'], 1),
    (v_mod, 'card_payments', 'Card payments', 'Collect a card payment on an invoice.', 'available', 'add_on', array['payments.processor'], 2),
    (v_mod, 'refunds', 'Refunds', 'Reversing a collected payment.', 'planned', 'optional', array[]::text[], 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'connected_processor';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'card_payments', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'card_payments';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'card_payments', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_finops, 'job_economics', 'Job Economics', 'What a job earned against what it cost.', 5)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'revenue_costs', 'Revenue & costs', 'What a job billed and what it consumed.', 'available', 'included', 1),
    (v_mod, 'gross_margin', 'Gross margin', 'Revenue minus cost, per job.', 'available', 'included', 2),
    (v_mod, 'estimated_vs_actual', 'Estimated vs. actual', 'Quoted figures against what actually happened.', 'partial', 'optional', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'gross_margin';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'job_economics', 'jobEconomics() -- always available once billing is used, not itself a separate switch.');

  -- Automation ---------------------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_auto, 'workflows', 'Workflows', 'Rules a business writes.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'rule_authoring', 'Rule authoring', 'When/if/then, in a business''s own words.', 'available', 'core', 1);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'rule_authoring';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'automations', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_auto, 'triggers', 'Triggers', 'What starts a rule.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'domain_event_trigger', 'Domain event', 'A rule fires the moment something happens.', 'available', 'core', 1),
    (v_mod, 'counter_trigger', 'Counter threshold', 'A rule fires when a running count crosses a value.', 'available', 'included', 2),
    (v_mod, 'external_condition_trigger', 'External condition', 'A rule fires when a reading (e.g. weather) crosses a threshold.', 'available', 'included', 3),
    (v_mod, 'schedule_trigger', 'Wall-clock schedule', 'A rule fires at a fixed time.', 'planned', 'optional', 4);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'domain_event_trigger';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'automations', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_auto, 'logic', 'Logic', 'Conditions inside a rule.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'conditions', 'Conditions', 'Only act if this is true.', 'available', 'included', 1),
    (v_mod, 'branching', 'Branching', 'Different actions for different conditions in one rule.', 'partial', 'optional', 2);

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_auto, 'actions', 'Actions', 'What a rule actually does.', 4)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, metered, meter_ids, display_order) values
    (v_mod, 'email_action', 'Send email', 'A rule sends an email.', 'available', 'included', true, array['email_send'], 1),
    (v_mod, 'update_customer_action', 'Update customer', 'A rule changes a customer record.', 'available', 'included', false, array[]::text[], 2),
    (v_mod, 'update_work_action', 'Update work', 'A rule changes or reschedules a job.', 'available', 'included', false, array[]::text[], 3),
    (v_mod, 'create_work_action', 'Create work', 'A rule creates a new job.', 'available', 'included', false, array[]::text[], 4),
    (v_mod, 'sms_action', 'Send SMS', 'A rule sends a text.', 'planned', 'optional', true, array['sms_segment'], 5),
    (v_mod, 'voice_action', 'Place outbound call', 'A rule places a call.', 'partial', 'optional', true, array['voice_minutes'], 6),
    (v_mod, 'webhook_action', 'Webhook / API', 'A rule calls an external URL.', 'planned', 'optional', false, array[]::text[], 7),
    (v_mod, 'ai_classify_action', 'AI: classify', 'A model classifies something for a rule.', 'planned', 'add_on', true, array['ai_tokens_input', 'ai_tokens_output'], 8),
    (v_mod, 'ai_generate_action', 'AI: generate', 'A model drafts content for a rule.', 'planned', 'add_on', true, array['ai_tokens_input', 'ai_tokens_output'], 9);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'email_action';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'automations', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_auto, 'runtime_review', 'Runtime & Review', 'Whether rules actually ran, and reading them back.', 5)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'run_history', 'Run history', 'Every time a rule fired, and what happened.', 'available', 'core', 1),
    (v_mod, 'rule_review', 'Rule review', 'Rules read back to a business: dead ends, unit mismatches, conflicts.', 'available', 'included', 2);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'run_history';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'automations', '');

  -- Insights -------------------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_insights, 'dashboards', 'Dashboards', 'Saved reports pinned together, per audience.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'saved_dashboards', 'Saved dashboards', 'A layout of reports, shared by role.', 'available', 'included', 1);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'saved_dashboards';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reporting', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_insights, 'reports', 'Reports', 'A defined question, over the business''s own numbers.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'saved_reports', 'Saved reports', 'A report definition a business keeps.', 'available', 'core', 1),
    (v_mod, 'financial_reports', 'Financial reports', 'Invoiced and incurred, by customer/service/resource.', 'available', 'included', 2),
    (v_mod, 'exports', 'Exports', 'Taking a report out as a file.', 'planned', 'optional', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'saved_reports';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reporting', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_insights, 'analytics', 'Analytics', 'Utilisation and profitability over time.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'utilization', 'Utilisation', 'Committed time against opening hours.', 'available', 'included', 1),
    (v_mod, 'profitability', 'Profitability', 'Margin, grouped by customer/service/resource.', 'available', 'included', 2),
    (v_mod, 'trends', 'Trends', 'A number, over time.', 'planned', 'optional', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'utilization';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'reporting', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_insights, 'intelligence', 'Intelligence', 'Asking a question in plain words.', 4)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, metered, ai_powered, meter_ids, provider_capabilities, display_order) values
    (v_mod, 'ask_gold', 'Ask GOLD', 'A question, answered from the business''s own data, through the same tools and permissions a person has.', 'available', 'add_on', true, true, array['ai_tokens_input', 'ai_tokens_output'], array['ai.inference'], 1),
    (v_mod, 'executive_summary', 'Executive summary', 'A written summary of how the business is doing.', 'planned', 'add_on', true, true, array['ai_tokens_input', 'ai_tokens_output'], array['ai.inference'], 2),
    (v_mod, 'anomaly_explanation', 'Anomaly explanation', 'Why a number moved.', 'planned', 'add_on', true, true, array['ai_tokens_input', 'ai_tokens_output'], array['ai.inference'], 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'ask_gold';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'assistant', '');

  -- Customer Experience ----------------------------------------------------
  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_cx, 'website', 'Website', 'A business''s own public site.', 1)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'pages_sections', 'Pages & sections', 'A homepage built from a closed set of section types.', 'available', 'core', 1),
    (v_mod, 'draft_review_publish', 'Draft, review, publish', 'A revision lifecycle before anything goes live.', 'available', 'core', 2),
    (v_mod, 'seo_metadata', 'SEO metadata', 'Titles, descriptions, structured data.', 'partial', 'included', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'pages_sections';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'public_site', 'public_sites/public_pages -- no module switch today, always available.');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_cx, 'public_booking', 'Public Booking', 'A page the public can reach and book a free slot from.', 2)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'service_selection', 'Service selection', 'Choosing what to book.', 'available', 'core', 1),
    (v_mod, 'availability_display', 'Availability display', 'Showing free slots, advisory until committed.', 'available', 'core', 2),
    (v_mod, 'booking', 'Booking', 'Taking a free slot, no account required.', 'available', 'core', 3),
    (v_mod, 'rescheduling_cancellation', 'Rescheduling & cancellation', 'Changing a booking after the fact, from the public side.', 'planned', 'optional', 4);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'booking';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'booking', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_cx, 'customer_portal', 'Customer Portal', 'A customer signs in by invitation.', 3)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'portal_auth', 'Portal authentication', 'Signing in by invitation, not a membership.', 'available', 'core', 1),
    (v_mod, 'portal_history', 'Appointments, work & invoices', 'A customer''s own view of their history.', 'available', 'core', 2);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'portal_auth';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'portal', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_cx, 'forms_intake', 'Forms & Intake', 'Bringing in a lead or a request.', 4)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'booking_intake', 'Booking intake', 'The form that starts a public booking.', 'available', 'core', 1),
    (v_mod, 'contact_forms', 'Contact forms', 'A general-purpose enquiry form.', 'planned', 'optional', 2),
    (v_mod, 'questionnaires', 'Questionnaires', 'Configurable multi-question intake.', 'planned', 'add_on', 3);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'booking_intake';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'booking', '');

  insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
    values (v_cx, 'brand_domains', 'Brand & Domains', 'A business''s own identity in public.', 5)
    returning id into v_mod;
  insert into public.platform_catalog_features (module_id, key, label, description, implementation_state, packaging_default, display_order) values
    (v_mod, 'brand_theme', 'Brand theme', 'Logo and accent colours on public surfaces.', 'available', 'core', 1),
    (v_mod, 'domain_binding', 'Sending/site domain', 'A business''s own domain, bound to GOLD infrastructure.', 'partial', 'optional', 2);
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'brand_theme';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'kernel', 'brand_settings', '');
  select id into v_feat from public.platform_catalog_features where module_id = v_mod and key = 'domain_binding';
  insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'provider_key', 'resend', 'Sending-domain binding exists; site hostname routing is M16.');

  -- GOLD Internal Plan -----------------------------------------------------
  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values ('gold_internal', 'plan', 'GOLD Internal', 'Non-billable. Every currently implemented capability, for GOLD''s own organization to dogfood with metering left on.', false, 'unlisted', 1, v_seed_user)
  returning id into v_plan_gold_internal;

  insert into public.platform_plan_product_grants (plan_id, product_id)
  select v_plan_gold_internal, id from public.platform_catalog_products;

  insert into public.platform_plan_quotas (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy, display_order) values
    (v_plan_gold_internal, 'ai_tokens', 'AI tokens', 'token', 5000000, 'month', null, 'allowed', 1),
    (v_plan_gold_internal, 'voice_minutes', 'Voice minutes', 'minute', 100000, 'month', null, 'allowed', 2),
    (v_plan_gold_internal, 'users', 'Users', 'user', 999, 'none', null, 'not_applicable', 3);
end;
$seed$;
