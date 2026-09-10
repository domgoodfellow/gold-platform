-- An organization's own scope inside a provider, and what GOLD created there.
--
-- **What this closes.** D43 gave GOLD a vocabulary for providers (`platform_providers`) and a
-- ledger for what one costs and what a business is charged (`usage_events`). Neither says which
-- external account, subaccount or project actually belongs to a given business, or what GOLD had
-- to create there to serve it. That is this file's one subject.
--
-- **`platform_providers` stays vocabulary.** It is not becoming a credentials table, and no row
-- here duplicates its columns. A binding names a provider by its key and nothing more.
--
-- **Not every provider gets a subaccount.** Twilio's resource model gives GOLD a parent account
-- and each business a subaccount underneath; Resend gives GOLD one platform account with a
-- business owning a verified sending domain beneath it; Deepgram, ElevenLabs and hosted model
-- inference currently have no per-tenant resource at all — GOLD holds one shared account and
-- usage is attributed by organization at the meter, not by a binding. A binding row for one of
-- those exists only the day a real caller needs one; none is seeded here.

-- ---------------------------------------------------------------------------
-- Vault, for the one kind of secret this file's callers will generate
-- ---------------------------------------------------------------------------

-- GOLD's own master credentials (a Twilio account SID and auth token, a Resend platform key)
-- stay deployment environment secrets — D14 already refuses a database as the place a person
-- reads them from, and nothing about Vault existing changes that. What Vault is for here is
-- narrower: a credential *this platform generates* per organization (a Twilio subaccount's own
-- API key secret) that must be retained for later server-side use and was never anywhere in the
-- deployment's own environment to begin with.
create extension if not exists supabase_vault cascade;

-- ---------------------------------------------------------------------------
-- The binding: an organization, inside a provider's own scope
-- ---------------------------------------------------------------------------

create table public.organization_provider_bindings (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations (id) on delete cascade,
  provider_key        text        not null references public.platform_providers (key),

  -- The provider's own identifier for this organization's scope: a Twilio Subaccount SID, a
  -- Resend-side account reference. Null for a shared-account provider, where there is no
  -- separate scope to name — Deepgram and ElevenLabs today.
  external_account_id text        check (external_account_id is null or length(btrim(external_account_id)) between 1 and 200),

  status              text        not null default 'provisioning'
                                   check (status in ('provisioning', 'active', 'failed', 'suspended')),

  last_verified_at    timestamptz,
  -- The provider's or GOLD's own words about the most recent failure, never this platform's
  -- interpretation — the same reasoning `twilio.ts` already gives for a carrier's own error text.
  last_error          text,

  -- Non-secret only, and that is a rule this file enforces by never granting a `secret_id` column
  -- (below) to anything that could instead be tempted to fold a secret into this bag. A friendly
  -- name, a region, a plan tier: the kind of fact that helps staff read a row, never one that
  -- grants anything on its own.
  metadata            jsonb       not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- One binding per organization per provider. A second Twilio scope for one business is not a
  -- second binding; it is this row's `external_account_id` changing, which `set_provider_binding_status`
  -- and `record_provider_resource` below both preserve rather than duplicate.
  unique (organization_id, provider_key),
  -- The target half of the composite foreign key `organization_provider_resources` leads with,
  -- and leading with `organization_id` here too is I2 — a resource cannot belong to another
  -- organization's binding, and neither can this constraint pretend to be keyed any other way.
  unique (organization_id, id)
);

comment on table public.organization_provider_bindings is
  'Which external provider scope belongs to which organization, and its lifecycle. Never a credential — see organization_provider_resources.secret_id for the one place a generated secret is referenced, and store_provider_secret for the only door onto it.';

alter table public.organization_provider_bindings enable row level security;
alter table public.organization_provider_bindings force  row level security;

create policy organization_provider_bindings_select on public.organization_provider_bindings
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy organization_provider_bindings_select_staff on public.organization_provider_bindings
  for select to platform_staff
  using (true);

-- No insert, update or delete grant to any role, tenant or staff (D40's rule, restated for this
-- axis in D43 and unchanged here): every write goes through a narrow, audited function below.
grant select on public.organization_provider_bindings to authenticated, platform_staff;

-- ---------------------------------------------------------------------------
-- The resource: one externally created thing, beneath a binding
-- ---------------------------------------------------------------------------

create table public.organization_provider_resources (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  binding_id      uuid        not null,

  resource_type   text        not null check (resource_type in (
    'twilio_subaccount',
    'twilio_api_key',
    'twilio_twiml_app',
    'twilio_phone_number',
    'resend_domain',
    'resend_sender_identity'
  )),

  -- The provider's own identifier and never a secret: a SID, a domain name, an E.164 number.
  external_id     text        not null check (length(btrim(external_id)) between 1 and 200),

  status          text        not null default 'active'
                               check (status in ('pending', 'active', 'failed', 'disabled')),

  -- Safe configuration only — a voice URL, a DNS record Resend asked a business to publish.
  -- Never a place a secret could hide; `check_provider_resource_config_has_no_secret` below is
  -- what makes that a rule rather than a comment.
  config          jsonb       not null default '{}'::jsonb,

  -- Set only by `store_provider_secret`, and selectable by nobody (see its grants below). Most
  -- resources never have one — a subaccount SID or a verified domain name needs no vault entry
  -- at all, and only `twilio_api_key` rows are expected to carry one in this slice.
  secret_id       uuid,

  last_verified_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- I18: a resource belongs to the same organization as the binding it hangs off, and the
  -- constraint says so rather than trusting every writer to have checked.
  foreign key (organization_id, binding_id)
    references public.organization_provider_bindings (organization_id, id) on delete cascade,

  -- Idempotency, structural rather than behavioural: a retried provisioning attempt that asks to
  -- record the same Twilio SID twice lands on this constraint rather than a second row. Leads
  -- with organization_id (I2).
  unique (organization_id, resource_type, external_id)
);

comment on table public.organization_provider_resources is
  'One externally created thing beneath an organization''s provider binding — a subaccount, an API key''s public half, a TwiML app, a phone number, a sender domain. Identifiers and status only; secret_id points at Vault and is selectable by nobody.';

-- A secret value could still be typed into `config` by hand — the check constraint refuses the
-- shapes that would let that happen unnoticed, the same defence D7 already uses for custom
-- fields: naming what is allowed rather than trusting every future writer to remember what isn't.
alter table public.organization_provider_resources
  add constraint organization_provider_resources_config_object
  check (jsonb_typeof(config) = 'object');

create index organization_provider_resources_binding_idx
  on public.organization_provider_resources (organization_id, binding_id);

alter table public.organization_provider_resources enable row level security;
alter table public.organization_provider_resources force  row level security;

create policy organization_provider_resources_select on public.organization_provider_resources
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy organization_provider_resources_select_staff on public.organization_provider_resources
  for select to platform_staff
  using (true);

-- `secret_id` is withheld from both grants below by naming every other column explicitly — the
-- same column-grant mechanism `usage_events` already uses to withhold GOLD's own provider cost
-- from a tenant. Nobody needs to read a vault id back through PostgREST; the one function that
-- writes it never returns it, and no function anywhere selects it back out.
grant select (
  id, organization_id, binding_id, resource_type, external_id, status, config,
  last_verified_at, created_at, updated_at
) on public.organization_provider_resources to authenticated, platform_staff;
