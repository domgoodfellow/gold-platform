-- A tenant's own external data sources — D33's build, kept apart from D44 on purpose.
--
-- **The distinction this file exists to hold.** `organization_provider_bindings` (D44) is GOLD's
-- own infrastructure inside a vendor account *GOLD* controls: a Twilio subaccount GOLD's master
-- credentials create, a Resend domain under GOLD's own account. The tenant never holds that
-- credential and never authorizes it — staff does, or GOLD's own application code calling a
-- vendor API with GOLD's own secret. What this file adds is the opposite ownership, D33's own
-- words: "the tenant holds the account and the credential. GOLD stores a reference, never a
-- shared key." A tenant's own Google account, its own HubSpot portal, its own uploaded CSV file
-- — the tenant is the vendor-side principal, and the write is the tenant's own action, not
-- staff's. Reusing `organization_provider_bindings` for this would borrow a table whose RLS,
-- grants and SECURITY DEFINER doors all assume the writer is staff; this is a tenant table, RLS
-- policy-gated like `customers`, because the party who may write a connection down is the party
-- who owns it.
--
-- **`connector_key` and `resource_type` are open vocabulary, not a closed list.** Unlike
-- `organization_provider_resources.resource_type` (a fixed handful of Twilio/Resend shapes GOLD
-- alone provisions), a new integration connector is added by writing an adapter under
-- `lib/adapters/`, not by a migration — the same reasoning `organization_modules.module_key`
-- already applies to a module key. Both columns below are regex-constrained free text for that
-- reason. The literal strings ('csv', 'google_workspace', 'google_sheet', …) are data, never
-- code that branches on them outside `lib/adapters/*/registry.ts` (I15) — the same distinction
-- D44 already drew for `resourceType`.

-- ---------------------------------------------------------------------------
-- The capability
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'customer.update',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create',
    'work_item.transition',
    'work_item.schedule',
    'work_item.record',
    'organization.manage',
    'price.manage',
    'work_item.price',
    'work_item.update',
    'invoice.issue',
    'payment.record',
    'automation.manage',
    'configuration.propose',
    'assistant.ask',
    'report.read',
    'report.manage',
    'call.place',
    'integration.manage'
  ]::text[]);

-- Onto whoever already changes this business's own settings — connecting a data source is that
-- same kind of decision, not a narrower one. A business that wants somebody else to hold it
-- grants the capability apart from `organization.manage` going forward; this only backfills what
-- already exists.
update public.roles
   set capabilities = capabilities || array['integration.manage']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('integration.manage' = any (capabilities));

-- A generic capability check, extracted here because this file's own doors need it four times —
-- the same threshold `app.require_platform_staff` was extracted at, one axis over. Returns the
-- caller so each door doesn't re-derive `auth.uid()` a second way.
create function app.require_capability(p_organization_id uuid, p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;

  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, p_capability) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  return v_actor;
end;
$fn$;

comment on function app.require_capability(uuid, text) is
  'Raises unless the caller belongs to the organization and holds the named capability; returns the caller''s id otherwise. Called from inside SECURITY DEFINER functions that have no RLS policy of their own to lean on.';

revoke all on function app.require_capability(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- integration_connections — a tenant's authorization to an external system
-- ---------------------------------------------------------------------------

create table public.integration_connections (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  connector_key   text        not null check (connector_key ~ '^[a-z][a-z0-9_]{0,40}$'),

  -- What this business sees when it looks at the connection: an account email, a portal name.
  -- Never a credential — the same column a resource's `external_id` already isn't one.
  account_label   text        check (account_label is null or length(btrim(account_label)) between 1 and 200),

  status          text        not null default 'connecting'
                               check (status in ('connecting', 'active', 'needs_attention', 'disconnected')),

  -- OAuth scopes granted, informational only — nothing here is checked against it; a connector
  -- adapter asks the vendor, never this column, before it acts.
  scopes          text[]      not null default '{}'::text[],

  -- A Vault pointer and nothing else, withheld from every grant below by the same mechanism
  -- `organization_provider_resources.secret_id` already uses (I34, reapplied to a tenant-writable
  -- table rather than a staff-only one). Written only by `store_integration_secret`.
  secret_id       uuid,

  connected_by    uuid        not null references auth.users (id),
  last_verified_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The composite-FK target every child table below leads with (I2).
  unique (organization_id, id)
);

comment on table public.integration_connections is
  'A tenant''s own authorization to an external system — D33''s axis, never D44''s. The tenant holds the account; GOLD stores a reference. secret_id is withheld from every grant and written only through store_integration_secret.';

create index integration_connections_org_idx on public.integration_connections (organization_id, status);

alter table public.integration_connections enable row level security;
alter table public.integration_connections force  row level security;

create policy integration_connections_select on public.integration_connections
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy integration_connections_insert on public.integration_connections
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and connected_by = (select auth.uid())
    and app.has_capability(organization_id, 'integration.manage')
  );

create policy integration_connections_update on public.integration_connections
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'))
  with check (organization_id in (select app.current_tenant_ids()));

-- No delete policy, matching `customers`/`field_definitions`: a connection is retired by status,
-- never removed, because rows this platform imported must go on naming where they came from.
grant select, insert on public.integration_connections to authenticated;
-- `secret_id` named out of the update grant explicitly (D44's mechanism, restated): everything
-- else here is a tenant's own fact about its own connection.
grant update (connector_key, account_label, status, scopes, last_verified_at, updated_at) on public.integration_connections to authenticated;

-- ---------------------------------------------------------------------------
-- integration_resources — one specific thing reachable through a connection
-- ---------------------------------------------------------------------------

create table public.integration_resources (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  connection_id   uuid        not null,

  resource_type   text        not null check (resource_type ~ '^[a-z][a-z0-9_]{0,40}$'),

  -- The vendor's own identifier — a spreadsheet id, a calendar id. Null for a resource with none,
  -- an uploaded file's own row (`storage_path` names it instead).
  external_id     text        check (external_id is null or length(btrim(external_id)) between 1 and 500),

  display_name    text        not null check (length(btrim(display_name)) between 1 and 200),
  metadata        jsonb       not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),

  status          text        not null default 'active'
                               check (status in ('active', 'needs_attention', 'disabled')),

  -- Set only for a resource this platform itself holds bytes for (a CSV/XLSX upload) — the
  -- `documents` bucket's own tenant-prefixed path convention, reused rather than cloned, because
  -- an import file is not a fourth thing `documents`'s exactly-one-owner check should learn to
  -- name (its four columns are entities a person attaches a file to; an import resource is a
  -- different axis entirely). Null for every API-reached resource, which has no bytes here.
  storage_path    text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (organization_id, connection_id)
    references public.integration_connections (organization_id, id) on delete cascade,

  unique (organization_id, id)
);

comment on table public.integration_resources is
  'One specific thing reachable through a connection — a sheet, a tab, a pipeline, an uploaded file. storage_path is set only for a file this platform holds the bytes of.';

create index integration_resources_connection_idx on public.integration_resources (organization_id, connection_id);

alter table public.integration_resources enable row level security;
alter table public.integration_resources force  row level security;

create policy integration_resources_select on public.integration_resources
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy integration_resources_insert on public.integration_resources
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'integration.manage')
  );

create policy integration_resources_update on public.integration_resources
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'))
  with check (organization_id in (select app.current_tenant_ids()));

grant select, insert, update on public.integration_resources to authenticated;

-- ---------------------------------------------------------------------------
-- integration_mappings — what a resource's data means in GOLD's own terms
-- ---------------------------------------------------------------------------

create table public.integration_mappings (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  resource_id     uuid        not null,

  -- Only one target exists a caller may name — the same "no seventh kind" discipline D7 already
  -- applies to a custom field. Widened by a later migration the day a second entity has a real
  -- caller, never ahead of one.
  target_entity   text        not null default 'customer' check (target_entity in ('customer')),

  -- {source_column, target, transform}[] — structured configuration, the same shape automation
  -- conditions and actions already store as jsonb rather than a family of typed tables for a
  -- rule this platform does not interpret beyond "apply this transform to this column."
  mapping         jsonb       not null default '[]'::jsonb check (jsonb_typeof(mapping) = 'array'),

  -- The target field a re-imported row is matched on for idempotency — 'email' today, since
  -- that's the one column `customers` itself uniquely indexes per tenant.
  dedupe_key      text        check (dedupe_key is null or length(btrim(dedupe_key)) between 1 and 100),

  -- One value today, on purpose (see the file header on `constraints.md`'s own widen-the-check
  -- pattern for `platform_meters`/providers): a periodic pull or a two-way sync is a real,
  -- separate later change, not a value sitting unused in this check waiting for a caller.
  sync_mode       text        not null default 'import' check (sync_mode in ('import')),

  created_by      uuid        not null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (organization_id, resource_id)
    references public.integration_resources (organization_id, id) on delete cascade,

  unique (organization_id, id)
);

comment on table public.integration_mappings is
  'How one resource''s columns become GOLD fields. Never joined to by a run once it has executed (I8) — see import_runs.mapping_snapshot.';

create index integration_mappings_resource_idx on public.integration_mappings (organization_id, resource_id);

alter table public.integration_mappings enable row level security;
alter table public.integration_mappings force  row level security;

create policy integration_mappings_select on public.integration_mappings
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy integration_mappings_insert on public.integration_mappings
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'integration.manage')
  );

create policy integration_mappings_update on public.integration_mappings
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'))
  with check (organization_id in (select app.current_tenant_ids()));

grant select, insert on public.integration_mappings to authenticated;
grant update (mapping, dedupe_key, updated_at) on public.integration_mappings to authenticated;

-- ---------------------------------------------------------------------------
-- The one door onto a connection's secret — D44's Vault shape, reapplied
-- ---------------------------------------------------------------------------

create extension if not exists supabase_vault cascade;

-- Mirrors `store_provider_secret` exactly, one axis over: writes once, returns only the
-- connection id it acted on, never the secret and never the vault row's own id. No role —
-- `authenticated` included — ever holds `select` on `vault.secrets` or `vault.decrypted_secrets`;
-- that absence is the guarantee, not this function's body.
create function public.store_integration_secret(
  p_organization_id uuid,
  p_connection_id   uuid,
  p_secret          text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_existing uuid;
  v_secret_id uuid;
begin
  perform app.require_capability(p_organization_id, 'integration.manage');

  if btrim(coalesce(p_secret, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;

  select secret_id into v_existing
  from public.integration_connections
  where id = p_connection_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'no such connection for that organization' using errcode = '22023';
  end if;

  if v_existing is null then
    v_secret_id := vault.create_secret(
      p_secret,
      p_connection_id::text,
      'OAuth credential for integration_connections.' || p_connection_id::text
    );

    update public.integration_connections
       set secret_id  = v_secret_id,
           updated_at = now()
     where id = p_connection_id;
  else
    perform vault.update_secret(v_existing, p_secret);
    v_secret_id := v_existing;
  end if;

  return p_connection_id;
end;
$fn$;

comment on function public.store_integration_secret(uuid, uuid, text) is
  'The only door onto a tenant''s own connection secret. Returns the connection id it acted on, never the secret or the vault row''s own id (I34, one axis over).';

revoke all on function public.store_integration_secret(uuid, uuid, text) from public;
grant execute on function public.store_integration_secret(uuid, uuid, text) to authenticated;
