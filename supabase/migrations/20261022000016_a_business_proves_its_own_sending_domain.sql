-- A business's own sending domain, proved at the provider rather than merely typed into a form.
--
-- **What was here before.** `record_organization_email_domain` (20260912000003) wrote one
-- `resend_domain` resource at status `pending` and stopped. Nothing ever asked the provider to
-- create the domain, nothing learned which DNS records it wanted, and nothing could ever move the
-- row off `pending` except a platform staff member calling `set_provider_resource_status` by hand.
-- The screen said "Verification required" about a verification no runtime had started. That is the
-- gap this file closes: `active` now means the provider says the domain is usable, and the records
-- it asked for are durable state a person can publish or a connected DNS zone can publish for them.
--
-- **No new table.** `organization_provider_resources` already models exactly this -- one externally
-- created thing beneath an organization's provider binding -- and its own `config` comment already
-- named "a DNS record Resend asked a business to publish" as the kind of thing that column is for.
-- The durable additions are two keys inside that object (`provider_domain_id`, `dns_records`) plus
-- the error keys `set_provider_resource_status` already established (`last_error`), and the
-- resource's own `status`/`last_verified_at` columns carry the lifecycle. A separate
-- `email_domains` table would have been a second place to ask "is this domain ready", which is the
-- `organization_domains` shape and is only justified there because a hostname also carries a
-- surface, a primary flag and a certificate -- none of which a sending domain has.
--
-- **Who may write what, restated for a third axis.** The tenant names the domain
-- (`record_organization_email_domain`, `organization.manage`) and may let it go
-- (`release_organization_email_domain`, same capability). Only `provider_operator` -- the machine
-- role `apps/api` wears after proving under the caller's own token that this person may manage this
-- business's email -- may say what the provider answered. Neither a tenant nor a staff token can
-- mark a sending domain `active` that no provider checked, for the same reason
-- `set_custom_domain_verification` is `provider_operator`'s alone.

-- ---------------------------------------------------------------------------
-- What a provider-required DNS record is allowed to look like
-- ---------------------------------------------------------------------------

-- `app.valid_dns_records` (20261010000001) answers for the hosting side of this same bridge and
-- deliberately stays as it is: four record types, a 500-character value and no other keys. Email
-- needs a wider shape and a second validator is the honest way to have one -- an MX record for the
-- bounce subdomain, a DKIM public key far longer than 500 characters, and two facts per record that
-- the hosting side has no equivalent of: what the record is *for* (so a person reading the table
-- knows which one their DNS host already has) and whether the provider has seen it yet.
--
-- `priority` is MX's own field rather than a general one: a CNAME or TXT carrying one would be a
-- value nothing could use, so it is refused rather than ignored.
create function app.valid_email_dns_records(p_records jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_typeof(p_records) = 'array'
     and jsonb_array_length(p_records) <= 12
     and not exists (
       select 1 from jsonb_array_elements(p_records) r
        where jsonb_typeof(r) <> 'object'
           or coalesce(r ->> 'type', '') not in ('MX', 'TXT', 'CNAME')
           or length(coalesce(r ->> 'name', '')) not between 1 and 253
           -- A 2048-bit DKIM public key is a little over 400 characters; 2000 leaves room for a
           -- longer key without becoming a place a whole document could be stored.
           or length(coalesce(r ->> 'value', '')) not between 1 and 2000
           or length(coalesce(r ->> 'purpose', '')) > 40
           or coalesce(r ->> 'status', 'pending') not in ('pending', 'verified', 'failed')
           or (r ? 'priority' and (r ->> 'type') <> 'MX')
           or (r ? 'priority' and jsonb_typeof(r -> 'priority') <> 'number')
     );
$fn$;

comment on function app.valid_email_dns_records(jsonb) is
  'The shape a provider-required sending-domain record may take. Wider than app.valid_dns_records (MX, a long DKIM value, purpose and status) and narrower in one way: priority belongs to MX alone.';

revoke all on function app.valid_email_dns_records(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The tenant's doors
-- ---------------------------------------------------------------------------

-- Asked by `apps/api` under the caller's own token before it reads any credential -- the same
-- shape as `can_manage_custom_domains` and `can_manage_integrations`: RLS and the capability
-- answer, never the runtime.
create function public.can_manage_email_domains(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_organization_id in (select app.current_tenant_ids())
     and app.has_capability(p_organization_id, 'organization.manage');
$fn$;

comment on function public.can_manage_email_domains(uuid) is
  'Whether this caller may configure this business''s sending domains. Asked by apps/api under the caller''s own token, before anything privileged happens.';

revoke all on function public.can_manage_email_domains(uuid) from public, anon;
grant execute on function public.can_manage_email_domains(uuid) to authenticated;

-- Recreated rather than edited (D15). Two changes, both about a retry: re-requesting a domain that
-- last failed clears the failure and returns it to `pending`, because the person pressing the
-- button is asking for another attempt and a stale error beside a fresh request is a lie; and a
-- re-request never touches a domain the provider has already verified, because nothing a form can
-- say should unverify one.
create or replace function public.record_organization_email_domain(
  p_organization_id uuid,
  p_domain          text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := (select auth.uid());
  v_domain      text := lower(btrim(p_domain));
  v_binding_id  uuid;
  v_resource_id uuid;
begin
  if v_actor is null then
    raise exception 'record_organization_email_domain requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  if v_domain = '' or v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'not a domain this platform can verify' using errcode = '22023';
  end if;

  -- GildOps holds one account with this provider; every organization's binding to it is `active`
  -- from the first moment, unlike Twilio's provisioning lifecycle -- there is no external account
  -- to create, only a domain to prove beneath GildOps' existing one.
  insert into public.organization_provider_bindings
    (organization_id, provider_key, status)
  values
    (p_organization_id, 'resend', 'active')
  on conflict (organization_id, provider_key) do nothing;

  select id into v_binding_id
  from public.organization_provider_bindings
  where organization_id = p_organization_id
    and provider_key = 'resend';

  insert into public.organization_provider_resources
    (organization_id, binding_id, resource_type, external_id, status)
  values
    (p_organization_id, v_binding_id, 'resend_domain', v_domain, 'pending')
  on conflict (organization_id, resource_type, external_id) do update
    set status     = case when public.organization_provider_resources.status = 'failed'
                          then 'pending'
                          else public.organization_provider_resources.status end,
        config     = public.organization_provider_resources.config - 'last_error' - 'error_code',
        updated_at = now()
  returning id into v_resource_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.email_domain_requested', jsonb_build_object('domain', v_domain));

  return v_resource_id;
end;
$fn$;

comment on function public.record_organization_email_domain(uuid, text) is
  'A business naming its own sending domain beneath GildOps'' one email provider account. Starts at pending; only record_email_domain_provisioning (provider_operator) ever moves it, because only the runtime that asked the provider knows what it said.';

-- Letting a domain go. A typo is the ordinary case, and a lifecycle that can reach `failed` with
-- no way out is not a lifecycle. `apps/api` deletes it at the provider first and then calls this
-- under the caller's own token, so the release is attributed to the person and refused by the
-- capability check if they may not -- exactly `release_custom_domain`'s shape, one axis over.
--
-- A delete rather than a status: `disabled` is the vocabulary for a resource GildOps still holds
-- at the provider and has switched off, and after the provider-side delete there is no such thing
-- left to describe. Nothing references this row (no foreign key points at it), so removing it
-- leaves nothing dangling, and the `events` row below is what survives to say it happened.
create function public.release_organization_email_domain(
  p_organization_id uuid,
  p_resource_id     uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_domain text;
begin
  if v_actor is null then
    raise exception 'release_organization_email_domain requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  delete from public.organization_provider_resources
   where id = p_resource_id
     and organization_id = p_organization_id
     and resource_type = 'resend_domain'
  returning external_id into v_domain;

  if v_domain is null then
    raise exception 'no such sending domain' using errcode = '22023';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.email_domain_released', jsonb_build_object('domain', v_domain));
end;
$fn$;

comment on function public.release_organization_email_domain(uuid, uuid) is
  'A business letting go of a sending domain it named. organization.manage, under the caller''s own token; apps/api deletes it at the provider first.';

revoke all on function public.release_organization_email_domain(uuid, uuid) from public, anon;
grant execute on function public.release_organization_email_domain(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The runtime's doors (provider_operator only)
-- ---------------------------------------------------------------------------

-- Which GildOps account answers for this business's sending domains: the one its binding was
-- placed under, else today's default for that provider. `apps/api` cannot read
-- `platform_provider_accounts` (staff-only RLS) or the binding's account column (withheld from
-- tenants), and must not be able to -- the same reasoning `custom_domain_provider_account` gives.
create function public.email_domain_provider_account(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select b.provider_account_id
       from public.organization_provider_bindings b
       join public.platform_provider_accounts a
         on a.id = b.provider_account_id and a.status = 'active'
      where b.organization_id = p_organization_id and b.provider_key = 'resend'),
    (select a.id
       from public.platform_provider_accounts a
      where a.provider_key = 'resend' and a.status = 'active' and a.is_default)
  );
$fn$;

comment on function public.email_domain_provider_account(uuid) is
  'The GildOps provider account that answers for this business''s sending domains, or null when none is active. provider_operator only: nothing signed in may learn which account serves it.';

revoke all on function public.email_domain_provider_account(uuid) from public, anon, authenticated;
grant execute on function public.email_domain_provider_account(uuid) to provider_operator;

-- What the provider said -- about a domain the tenant has already named, never a new one. The
-- resource must exist: this function creates nothing, so a runtime that could be tricked into
-- naming an organization still could not conjure a sending domain for it.
--
-- `p_status` is GildOps' own word for where the domain stands, mapped from the provider's by the
-- adapter that spoke to it; `p_provider_status` is the provider's own, kept beside it for the
-- sentence a person reads and never branched on here. `p_provider_domain_id` is the durable
-- external identifier a retry resumes from, and is coalesced: a recheck that passes none keeps the
-- one registration stored.
create function public.record_email_domain_provisioning(
  p_organization_id   uuid,
  p_resource_id       uuid,
  p_status            text,
  p_provider_domain_id text    default null,
  p_provider_status   text     default null,
  p_dns_records       jsonb    default null,
  p_error_code        text     default null,
  p_error_message     text     default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_found boolean;
begin
  if p_status not in ('pending', 'active', 'failed', 'disabled') then
    raise exception 'unknown resource status: %', p_status using errcode = '22023';
  end if;
  if p_dns_records is not null and not app.valid_email_dns_records(p_dns_records) then
    raise exception 'dns records must be a short array of {type, name, value}' using errcode = '22023';
  end if;

  update public.organization_provider_resources
     set status = p_status,
         config =
           -- Each key is set only when this call has something to say about it, so a recheck that
           -- carries no records does not erase the ones registration stored. The two error keys
           -- are cleared outright on success, because a stale error beside a verified domain is
           -- the failure mode this whole file exists to remove.
           (case when p_error_code is null and p_error_message is null
                 then config - 'last_error' - 'error_code'
                 else config
                      || jsonb_build_object('error_code', p_error_code)
                      || jsonb_build_object('last_error', left(p_error_message, 500))
            end)
           || (case when p_provider_domain_id is null then '{}'::jsonb
                    else jsonb_build_object('provider_domain_id', p_provider_domain_id) end)
           || (case when p_provider_status is null then '{}'::jsonb
                    else jsonb_build_object('provider_status', p_provider_status) end)
           || (case when p_dns_records is null then '{}'::jsonb
                    else jsonb_build_object('dns_records', p_dns_records) end),
         last_verified_at = case when p_status = 'active' then now() else last_verified_at end,
         updated_at = now()
   where id = p_resource_id
     and organization_id = p_organization_id
     and resource_type = 'resend_domain'
  returning true into v_found;

  if v_found is null then
    raise exception 'no such sending domain' using errcode = '22023';
  end if;
end;
$fn$;

comment on function public.record_email_domain_provisioning(uuid, uuid, text, text, text, jsonb, text, text) is
  'What the provider said about a sending domain the tenant already named. provider_operator only, for the reason set_custom_domain_verification is: only the runtime that asked may say what the answer was. Creates nothing.';

revoke all on function public.record_email_domain_provisioning(uuid, uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_email_domain_provisioning(uuid, uuid, text, text, text, jsonb, text, text) to provider_operator;
