-- The only doors onto a provider binding, a provider resource, or a generated secret.
--
-- **Platform staff still hold no insert, update or delete grant on either table** (D40's rule,
-- restated in D43, restated again here). Everything below is a `security definer` function,
-- checked and audited the same way `record_provider_rate` already is, granted `execute` to
-- `platform_staff` and to nobody else — except the last one, which is granted to nobody at all
-- who could ever read a secret back.
--
-- **Why staff may hold the plaintext of a secret it hands to `store_provider_secret` and still
-- never *select* one back.** The distinction this file exists to keep: staff generates a Twilio
-- subaccount's API key by calling Twilio, and for that one moment necessarily holds it in server
-- memory — there is no other way to create it. What must never exist is a second moment, later,
-- where that same value can be asked for again through this API. No function here returns a
-- secret. `vault.decrypted_secrets` is granted to nobody. The plaintext exists in exactly one
-- place after this transaction commits: inside Vault, encrypted, and only a future narrow
-- function this repository does not yet have may ever decrypt it again.

-- ---------------------------------------------------------------------------
-- Beginning, or resuming, a binding
-- ---------------------------------------------------------------------------

-- Idempotent on purpose (the whole of the provisioning requirement): calling this again for a
-- binding already `provisioning` or already `active` changes nothing and returns the same row's
-- id, so a retried orchestration never has two bindings to reconcile.
create function public.begin_provider_binding(
  p_organization_id uuid,
  p_provider_key    text
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
begin
  insert into public.organization_provider_bindings
    (organization_id, provider_key, status)
  values
    (p_organization_id, p_provider_key, 'provisioning')
  on conflict (organization_id, provider_key) do update
    -- A binding that already failed may be retried; one already active or already provisioning
    -- is left exactly as it is — this is a resume, never a downgrade.
    set status = case when public.organization_provider_bindings.status = 'failed'
                       then 'provisioning'
                       else public.organization_provider_bindings.status
                  end,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.begin_provider_binding(uuid, text) is
  'Starts, or resumes, one organization''s binding to one provider. Idempotent: never a second row for the same pair.';

revoke all on function public.begin_provider_binding(uuid, text) from public;
grant execute on function public.begin_provider_binding(uuid, text) to platform_staff;

-- ---------------------------------------------------------------------------
-- Recording what provisioning is deciding along the way
-- ---------------------------------------------------------------------------

create function public.set_provider_binding_status(
  p_organization_id     uuid,
  p_provider_key        text,
  p_status              text,
  p_external_account_id text default null,
  p_error               text default null
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
  if p_status not in ('provisioning', 'active', 'failed', 'suspended') then
    raise exception 'unknown binding status: %', p_status using errcode = '22023';
  end if;

  update public.organization_provider_bindings
     set status              = p_status,
         external_account_id = coalesce(p_external_account_id, external_account_id),
         last_verified_at    = case when p_status = 'active' then now() else last_verified_at end,
         last_error          = case when p_status = 'failed' then p_error else last_error end,
         updated_at          = now()
   where organization_id = p_organization_id
     and provider_key    = p_provider_key;

  if not found then
    raise exception 'no binding for that organization and provider — call begin_provider_binding first'
      using errcode = '22023';
  end if;
end;
$fn$;

comment on function public.set_provider_binding_status(uuid, text, text, text, text) is
  'The only way a binding''s status, external account id or last error changes. A failed attempt is this row, not a thrown exception nobody kept.';

revoke all on function public.set_provider_binding_status(uuid, text, text, text, text) from public;
grant execute on function public.set_provider_binding_status(uuid, text, text, text, text) to platform_staff;

-- ---------------------------------------------------------------------------
-- Recording one externally created resource
-- ---------------------------------------------------------------------------

-- Upserts by the same triple its unique constraint leads with, so calling this twice for the
-- Twilio subaccount SID a retried orchestration already created updates that one row rather than
-- writing a second.
create function public.record_provider_resource(
  p_organization_id uuid,
  p_provider_key    text,
  p_resource_type   text,
  p_external_id     text,
  p_config          jsonb default '{}'::jsonb,
  p_status          text default 'active'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff      text := app.require_platform_staff();
  v_binding_id uuid;
  v_id         uuid;
begin
  if p_status not in ('pending', 'active', 'failed', 'disabled') then
    raise exception 'unknown resource status: %', p_status using errcode = '22023';
  end if;

  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'resource config must be a JSON object' using errcode = '22023';
  end if;

  select id into v_binding_id
  from public.organization_provider_bindings
  where organization_id = p_organization_id
    and provider_key    = p_provider_key;

  if v_binding_id is null then
    -- A resource cannot precede its binding — that would be recording something for a provider
    -- scope this organization has never been given.
    raise exception 'no binding for that organization and provider — call begin_provider_binding first'
      using errcode = '22023';
  end if;

  insert into public.organization_provider_resources
    (organization_id, binding_id, resource_type, external_id, config, status)
  values
    (p_organization_id, v_binding_id, p_resource_type, p_external_id, p_config, p_status)
  on conflict (organization_id, resource_type, external_id) do update
    set config     = excluded.config,
        status     = excluded.status,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_provider_resource(uuid, text, text, text, jsonb, text) is
  'The only way an externally created resource is recorded, beneath a binding that must already exist. Idempotent on (organization_id, resource_type, external_id): a retried creation updates one row.';

revoke all on function public.record_provider_resource(uuid, text, text, text, jsonb, text) from public;
grant execute on function public.record_provider_resource(uuid, text, text, text, jsonb, text) to platform_staff;

create function public.set_provider_resource_status(
  p_organization_id uuid,
  p_resource_id     uuid,
  p_status          text,
  p_error           text default null
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
  if p_status not in ('pending', 'active', 'failed', 'disabled') then
    raise exception 'unknown resource status: %', p_status using errcode = '22023';
  end if;

  update public.organization_provider_resources
     set status     = p_status,
         config     = case when p_error is not null
                           then config || jsonb_build_object('last_error', p_error)
                           else config
                      end,
         last_verified_at = case when p_status = 'active' then now() else last_verified_at end,
         updated_at = now()
   where id = p_resource_id
     and organization_id = p_organization_id;

  if not found then
    raise exception 'no such resource for that organization' using errcode = '22023';
  end if;
end;
$fn$;

comment on function public.set_provider_resource_status(uuid, uuid, text, text) is
  'The only way a resource''s status (and, on failure, its last error) changes after it is recorded.';

revoke all on function public.set_provider_resource_status(uuid, uuid, text, text) from public;
grant execute on function public.set_provider_resource_status(uuid, uuid, text, text) to platform_staff;

-- ---------------------------------------------------------------------------
-- The one door onto Vault, and the only one that ever will be a write door
-- ---------------------------------------------------------------------------

-- Stores or rotates a resource's retained secret. Never returns it — the return value is the
-- resource id, exactly like `record_provider_resource`, so a caller confirms *which row* without
-- ever being handed back *what it holds*.
create function public.store_provider_secret(
  p_organization_id uuid,
  p_resource_id     uuid,
  p_secret          text
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

  select secret_id into v_existing
  from public.organization_provider_resources
  where id = p_resource_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'no such resource for that organization' using errcode = '22023';
  end if;

  if v_existing is null then
    v_secret_id := vault.create_secret(
      p_secret,
      p_resource_id::text,
      'Generated credential for organization_provider_resources.' || p_resource_id::text
    );

    update public.organization_provider_resources
       set secret_id  = v_secret_id,
           updated_at = now()
     where id = p_resource_id;
  else
    -- Rotation: the same vault row, a new value. `vault.update_secret` re-encrypts in place, so
    -- there is never a moment with two live secrets for one resource.
    perform vault.update_secret(v_existing, p_secret);
    v_secret_id := v_existing;
  end if;

  -- Not `v_secret_id`: a vault row's own id is exactly as sensitive as its content would be
  -- to hand back, and nothing in this repository selects `secret_id` back out either. The
  -- resource id is the one thing already known to whoever is calling.
  return p_resource_id;
end;
$fn$;

comment on function public.store_provider_secret(uuid, uuid, text) is
  'Stores or rotates a resource''s generated secret in Vault. Returns only the resource id — never the secret, never the vault row, to any caller, ever.';

revoke all on function public.store_provider_secret(uuid, uuid, text) from public;
grant execute on function public.store_provider_secret(uuid, uuid, text) to platform_staff;

-- No role, including platform_staff, is granted anything on `vault.secrets` or
-- `vault.decrypted_secrets` — the absence is the guarantee, not a policy that could be loosened
-- one line at a time. `provider-bindings.test.ts` asserts `permission denied` on both, directly.
