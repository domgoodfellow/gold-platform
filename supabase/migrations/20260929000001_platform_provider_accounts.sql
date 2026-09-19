-- GOLD's own account with a provider, as a row: which upstream account is the parent of every
-- organization's scope beneath it.
--
-- **Three things that were one word.** A *provider account* is a GOLD-owned upstream account (the
-- Twilio parent). An *organization provider binding* is the scope GOLD provisioned for one
-- tenant beneath it. A *resource* is one safe thing inside that scope. Until now the first existed
-- only as deployment environment variables, so the platform console could not say which account a
-- binding lived under, whether that account still worked, or let an operator rotate its
-- credential without a deploy. Nothing here touches a tenant-owned connection
-- (`integration_connections`) — that is a different owner and a different table.
--
-- **The credential is written to Vault and read back by exactly one machine role.** Staff can
-- write it and can learn that one exists and when it changed. Nobody signed in can read it:
-- `read_provider_account_credential` is granted to `provider_operator` alone, the role
-- `apps/api` mints a 60-second token for after it has proved the human caller is staff. That is
-- the only reason a machine role is added at all — the web runtime holds no signing secret and
-- must not (D14), and any function a staff JWT could call, that staff member could call from a
-- browser console.
--
-- **Deployment environment variables keep working.** A binding with no `provider_account_id` is a
-- bootstrap binding, exactly what every binding was before this file.

-- ---------------------------------------------------------------------------
-- The machine identity that may read a parent credential
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000a4')
on conflict (id) do nothing;

-- 00000000-0000-4000-8000-0000000000a4 is the provider-operations integration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'provider_operator') then
    create role provider_operator nologin noinherit;
  end if;
end
$$;

grant provider_operator to authenticator;
grant usage on schema public to provider_operator;

-- ---------------------------------------------------------------------------
-- The account
-- ---------------------------------------------------------------------------

create table public.platform_provider_accounts (
  id                    uuid        primary key default gen_random_uuid(),
  -- Open vocabulary: `platform_providers.key` is the only list of providers there is.
  provider_key          text        not null references public.platform_providers (key),
  label                 text        not null check (length(btrim(label)) between 1 and 120),

  -- The provider's own name for this account (a Twilio Account SID). Never a secret.
  external_account_id   text        check (external_account_id is null or length(btrim(external_account_id)) between 1 and 200),

  -- How the credential authenticates. Free text on purpose: what the words mean, and which are
  -- valid, is the provider adapter's vocabulary, not this schema's.
  credential_kind       text        not null check (length(btrim(credential_kind)) between 1 and 60),
  -- The public half of a credential (an API key's SID). Null when the mechanism has none.
  credential_identifier text        check (credential_identifier is null or length(btrim(credential_identifier)) between 1 and 200),

  -- Vault reference. Withheld from every grant below; nothing selects it back out.
  secret_id             uuid,
  -- When the stored value was last set or replaced — the only fact about it a person may read.
  credential_set_at     timestamptz,

  -- Lifecycle is GOLD's decision (may new tenants be provisioned here?); verification is the
  -- provider's answer (does this credential work?). Two facts, two columns.
  status                text        not null default 'active' check (status in ('active', 'disabled')),
  verification_state    text        not null default 'unverified'
                                    check (verification_state in ('unverified', 'verified', 'failed')),
  last_verified_at      timestamptz,
  verification_error    text,

  is_default            boolean     not null default false,

  -- Safe provider facts learned at verification (a friendly name, a plan type). Never a secret.
  metadata              jsonb       not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),

  created_by            uuid        references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (not is_default or status = 'active')
);

comment on table public.platform_provider_accounts is
  'A GOLD-owned account with an upstream provider (the parent of every tenant scope beneath it). Platform-wide, so it carries no organization_id, like platform_staff. secret_id points at Vault and is selectable by nobody.';

create unique index platform_provider_accounts_external_unique
  on public.platform_provider_accounts (provider_key, external_account_id)
  where external_account_id is not null;

-- One default per provider, structurally rather than by every writer remembering.
create unique index platform_provider_accounts_one_default
  on public.platform_provider_accounts (provider_key)
  where is_default;

alter table public.platform_provider_accounts enable row level security;
alter table public.platform_provider_accounts force  row level security;

create policy platform_provider_accounts_select on public.platform_provider_accounts
  for select to authenticated using (app.is_platform_staff());

-- Every column but `secret_id`, by name. No insert/update/delete grant to any role: writes are
-- the narrow functions below, exactly as for bindings and rates (D40).
grant select (
  id, provider_key, label, external_account_id, credential_kind, credential_identifier,
  credential_set_at, status, verification_state, last_verified_at, verification_error,
  is_default, metadata, created_by, created_at, updated_at
) on public.platform_provider_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- A binding says which account it lives under, and what reconciliation last found
-- ---------------------------------------------------------------------------

alter table public.organization_provider_bindings
  add column provider_account_id     uuid references public.platform_provider_accounts (id),
  add column reconciliation_state    text check (reconciliation_state is null
                                        or reconciliation_state in ('in_sync', 'remote_missing', 'remote_changed')),
  add column reconciliation_detail   text,
  add column last_reconciled_at      timestamptz;

-- A tenant reads its own binding and must never learn which GOLD account sits above it, nor what
-- GOLD's reconciliation said. The table-wide select is replaced by the columns a tenant already
-- had; staff read the new ones through `platform_provider_organization_overview`.
revoke select on public.organization_provider_bindings from authenticated;
grant select (
  id, organization_id, provider_key, external_account_id, status, last_verified_at, last_error,
  metadata, created_at, updated_at
) on public.organization_provider_bindings to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'platform_staff') then
    revoke select on public.organization_provider_bindings from platform_staff;
    grant select (
      id, organization_id, provider_key, external_account_id, status, last_verified_at, last_error,
      metadata, created_at, updated_at
    ) on public.organization_provider_bindings to platform_staff;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Writing an account (staff)
-- ---------------------------------------------------------------------------

create function public.record_provider_account(
  p_provider_key          text,
  p_label                 text,
  p_external_account_id   text,
  p_credential_kind       text,
  p_credential_identifier text,
  p_account_id            uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff text := app.require_platform_staff();
  v_id    uuid;
  v_first boolean;
begin
  if p_account_id is null then
    select not exists (
      select 1 from public.platform_provider_accounts where provider_key = p_provider_key and status = 'active'
    ) into v_first;

    insert into public.platform_provider_accounts
      (provider_key, label, external_account_id, credential_kind, credential_identifier, created_by, is_default)
    values
      (p_provider_key, p_label, nullif(btrim(p_external_account_id), ''), p_credential_kind,
       nullif(btrim(p_credential_identifier), ''), auth.uid(), v_first)
    returning id into v_id;
  else
    -- A changed identity means the stored credential no longer describes this account, so the
    -- last verification stops being evidence. It must be run again.
    update public.platform_provider_accounts a
       set label                 = p_label,
           credential_kind       = p_credential_kind,
           verification_state    = case when a.external_account_id is distinct from nullif(btrim(p_external_account_id), '')
                                          or a.credential_identifier is distinct from nullif(btrim(p_credential_identifier), '')
                                          or a.credential_kind <> p_credential_kind
                                        then 'unverified' else a.verification_state end,
           external_account_id   = nullif(btrim(p_external_account_id), ''),
           credential_identifier = nullif(btrim(p_credential_identifier), ''),
           updated_at            = now()
     where a.id = p_account_id and a.provider_key = p_provider_key
    returning a.id into v_id;

    if v_id is null then
      raise exception 'no such provider account' using errcode = '22023';
    end if;
  end if;

  return v_id;
end;
$fn$;

comment on function public.record_provider_account(text, text, text, text, text, uuid) is
  'Creates or edits the identity of a GOLD-owned provider account. Never touches the credential — see store_provider_account_credential.';

-- `create function` grants execute to PUBLIC, which every role inherits. Each door below states
-- its whole audience rather than relying on that default having been removed.
revoke all on function public.record_provider_account(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_provider_account(text, text, text, text, text, uuid) to authenticated;

create function public.store_provider_account_credential(
  p_account_id uuid,
  p_secret     text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff     text := app.require_platform_staff();
  v_existing  uuid;
  v_secret_id uuid;
begin
  if btrim(coalesce(p_secret, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;

  select secret_id into v_existing from public.platform_provider_accounts where id = p_account_id;
  if not found then
    raise exception 'no such provider account' using errcode = '22023';
  end if;

  if v_existing is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'provider_account:' || p_account_id::text,
      'Credential for platform_provider_accounts.' || p_account_id::text
    );
  else
    perform vault.update_secret(v_existing, p_secret);
    v_secret_id := v_existing;
  end if;

  -- A new credential is unproven until the provider says otherwise.
  update public.platform_provider_accounts
     set secret_id          = v_secret_id,
         credential_set_at  = now(),
         verification_state = 'unverified',
         verification_error = null,
         updated_at         = now()
   where id = p_account_id;

  -- The account id, never the secret and never the vault row's own id.
  return p_account_id;
end;
$fn$;

comment on function public.store_provider_account_credential(uuid, text) is
  'Stores or replaces a provider account''s credential in Vault. Returns only the account id.';

revoke all on function public.store_provider_account_credential(uuid, text) from public, anon;
grant execute on function public.store_provider_account_credential(uuid, text) to authenticated;

create function public.set_provider_account_status(
  p_account_id uuid,
  p_status     text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff text := app.require_platform_staff();
begin
  if p_status not in ('active', 'disabled') then
    raise exception 'unknown account status: %', p_status using errcode = '22023';
  end if;

  -- Disabling stops *new* provisioning under this account. It never reaches an existing binding,
  -- resource or the upstream account itself — that infrastructure is not this function's to end.
  update public.platform_provider_accounts
     set status     = p_status,
         is_default = case when p_status = 'disabled' then false else is_default end,
         updated_at = now()
   where id = p_account_id;

  if not found then
    raise exception 'no such provider account' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.set_provider_account_status(uuid, text) from public, anon;
grant execute on function public.set_provider_account_status(uuid, text) to authenticated;

create function public.set_default_provider_account(p_account_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff text := app.require_platform_staff();
  v_key   text;
begin
  select provider_key into v_key
  from public.platform_provider_accounts
  where id = p_account_id and status = 'active';

  if v_key is null then
    raise exception 'only an active provider account can be the default' using errcode = '22023';
  end if;

  update public.platform_provider_accounts
     set is_default = false, updated_at = now()
   where provider_key = v_key and is_default and id <> p_account_id;

  update public.platform_provider_accounts
     set is_default = true, updated_at = now()
   where id = p_account_id;
end;
$fn$;

revoke all on function public.set_default_provider_account(uuid) from public, anon;
grant execute on function public.set_default_provider_account(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The two doors the machine role holds
-- ---------------------------------------------------------------------------

-- The only function anywhere that returns a decrypted secret. `authenticated` is refused by name:
-- a staff member's own token must not be able to ask for it from a browser console.
create function public.read_provider_account_credential(p_account_id uuid)
returns table (
  provider_key          text,
  external_account_id   text,
  credential_kind       text,
  credential_identifier text,
  secret                text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select a.provider_key, a.external_account_id, a.credential_kind, a.credential_identifier,
         (select d.decrypted_secret from vault.decrypted_secrets d where d.id = a.secret_id)
    from public.platform_provider_accounts a
   where a.id = p_account_id
     and a.status = 'active'
     and a.secret_id is not null;
$fn$;

comment on function public.read_provider_account_credential(uuid) is
  'Returns a provider account''s decrypted credential to provider_operator and to nobody else. Granted to no signed-in role.';

revoke all on function public.read_provider_account_credential(uuid) from public, anon, authenticated;
grant execute on function public.read_provider_account_credential(uuid) to provider_operator;

-- Verification is recorded by the runtime that actually asked the provider, so a staff member
-- cannot mark an account verified by calling this from a browser.
create function public.record_provider_account_verification(
  p_account_id uuid,
  p_ok         boolean,
  p_error      text default null,
  p_metadata   jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'metadata must be a JSON object' using errcode = '22023';
  end if;

  update public.platform_provider_accounts
     set verification_state = case when p_ok then 'verified' else 'failed' end,
         last_verified_at   = now(),
         verification_error = case when p_ok then null else left(coalesce(p_error, 'verification failed'), 500) end,
         metadata           = case when p_ok then coalesce(p_metadata, '{}'::jsonb) else metadata end,
         updated_at         = now()
   where id = p_account_id;

  if not found then
    raise exception 'no such provider account' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.record_provider_account_verification(uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_account_verification(uuid, boolean, text, jsonb) to provider_operator;

-- ---------------------------------------------------------------------------
-- A binding begins under an account
-- ---------------------------------------------------------------------------

drop function public.begin_provider_binding(uuid, text);

create function public.begin_provider_binding(
  p_organization_id     uuid,
  p_provider_key        text,
  p_provider_account_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff   text := app.require_platform_staff();
  v_id      uuid;
  v_account uuid := p_provider_account_id;
begin
  if v_account is not null then
    perform 1 from public.platform_provider_accounts
     where id = v_account and provider_key = p_provider_key and status = 'active';
    if not found then
      raise exception 'that provider account is not an active account for this provider' using errcode = '22023';
    end if;
  end if;

  insert into public.organization_provider_bindings
    (organization_id, provider_key, status, provider_account_id)
  values
    (p_organization_id, p_provider_key, 'provisioning', v_account)
  on conflict (organization_id, provider_key) do update
    -- A resume, never a downgrade — and never a move: a binding that already has an account keeps
    -- it, so a retry cannot strand resources under one account while pointing at another.
    set status = case when public.organization_provider_bindings.status = 'failed'
                       then 'provisioning'
                       else public.organization_provider_bindings.status
                  end,
        provider_account_id = coalesce(public.organization_provider_bindings.provider_account_id, excluded.provider_account_id),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.begin_provider_binding(uuid, text, uuid) is
  'Starts, or resumes, one organization''s binding to one provider, under a GOLD provider account when one is named. Idempotent: never a second row for the same pair, and never moves a binding between accounts.';

revoke all on function public.begin_provider_binding(uuid, text, uuid) from public, anon;
grant execute on function public.begin_provider_binding(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording what reconciliation found
-- ---------------------------------------------------------------------------

create function public.record_provider_binding_reconciliation(
  p_organization_id uuid,
  p_provider_key    text,
  p_state           text,
  p_detail          text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff text := app.require_platform_staff();
begin
  if p_state not in ('in_sync', 'remote_missing', 'remote_changed') then
    raise exception 'unknown reconciliation state: %', p_state using errcode = '22023';
  end if;

  -- Records what was found. It changes no status and touches nothing upstream: a finding is an
  -- operator's to act on, never something reconciliation repairs or deletes by itself.
  update public.organization_provider_bindings
     set reconciliation_state  = p_state,
         reconciliation_detail = left(p_detail, 500),
         last_reconciled_at    = now()
   where organization_id = p_organization_id and provider_key = p_provider_key;

  if not found then
    raise exception 'no binding for that organization and provider' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.record_provider_binding_reconciliation(uuid, text, text, text) from public, anon;
grant execute on function public.record_provider_binding_reconciliation(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Every organization, and where it stands with one provider
-- ---------------------------------------------------------------------------

-- Left join from organizations, because "not provisioned" is a row the operator needs to see, and
-- a security-definer function because the binding columns it returns are withheld from every
-- table grant. Staff-checked inside.
create function public.platform_provider_organization_overview(
  p_provider_key    text,
  p_organization_id uuid default null
)
returns table (
  organization_id       uuid,
  organization_name     text,
  binding_id            uuid,
  binding_status        text,
  external_account_id   text,
  provider_account_id   uuid,
  last_verified_at      timestamptz,
  last_error            text,
  reconciliation_state  text,
  reconciliation_detail text,
  last_reconciled_at    timestamptz,
  resource_count        bigint,
  bound_at              timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_staff text := app.require_platform_staff();
begin
  return query
  select o.id, o.name, b.id, b.status, b.external_account_id, b.provider_account_id,
         b.last_verified_at, b.last_error, b.reconciliation_state, b.reconciliation_detail,
         b.last_reconciled_at,
         (select count(*) from public.organization_provider_resources r where r.binding_id = b.id),
         b.created_at
    from public.organizations o
    left join public.organization_provider_bindings b
      on b.organization_id = o.id and b.provider_key = p_provider_key
   where p_organization_id is null or o.id = p_organization_id
   order by o.name;
end;
$fn$;

revoke all on function public.platform_provider_organization_overview(text, uuid) from public, anon;
grant execute on function public.platform_provider_organization_overview(text, uuid) to authenticated;
