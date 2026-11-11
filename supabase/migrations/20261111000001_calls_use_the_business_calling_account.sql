-- Calls use the business's own calling account, end to end.
--
-- Until now a business's calling account (its carrier subaccount, key and application) was created
-- and recorded, and then not used: live calls ran on one set of carrier credentials held in the
-- deployment's environment. That cannot work for a number the business's own account owns. The
-- browser telephone signed in to the wrong account, the carrier's reports were checked against the
-- wrong signing secret, and inbound calls from any account but the deployment's were refused.
--
-- Three narrow doors, and no table change:
--
--   1. `telephony_signing_secret`  -- the carrier-callback machine role proves a report came from
--      the carrier for one calling account GildOps created. The secret is that account's own.
--   2. `read_organization_telephony_credential` -- the provider-operations machine role reads the
--      one business's own key, to place and control that business's calls and to sign its browser
--      telephone's credential. Never GildOps' parent credential.
--   3. `telephony_caller` -- a signed-in person's own token answers whether they may use this
--      business's telephone, and as which member. `apps/api` asks this before it reads anything.
--
-- The signing secret is stored on the existing `twilio_subaccount` resource through the existing
-- `store_provider_secret`; a resource has always been able to carry one.

-- ---------------------------------------------------------------------------
-- 1. Which secret signs one calling account's reports
-- ---------------------------------------------------------------------------

create function public.telephony_signing_secret(p_account_sid text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_secret text;
  v_count  integer;
begin
  -- A suspended business's in-flight calls still end, and the carrier still says so; those
  -- reports must be recorded. A failed or half-made account has nothing to report on.
  select count(*), min(d.decrypted_secret)
    into v_count, v_secret
    from public.organization_provider_resources r
    join public.organization_provider_bindings b
      on b.id = r.binding_id and b.organization_id = r.organization_id
    join vault.decrypted_secrets d on d.id = r.secret_id
   where r.resource_type = 'twilio_subaccount'
     and r.external_id = p_account_sid
     and r.status = 'active'
     and b.provider_key = 'twilio'
     and b.status in ('active', 'suspended');

  -- Exactly one business may own a calling account. Two rows naming the same account is a state
  -- nothing should act on, so it verifies nothing.
  if v_count <> 1 then
    return null;
  end if;
  return v_secret;
end;
$fn$;

comment on function public.telephony_signing_secret(text) is
  'The signing secret of one GildOps-created calling account, for verifying the carrier''s own reports. Granted to voice_webhook and to nobody else.';

revoke all on function public.telephony_signing_secret(text) from public, anon, authenticated;
grant execute on function public.telephony_signing_secret(text) to voice_webhook;

-- ---------------------------------------------------------------------------
-- 2. One business's own calling credential
-- ---------------------------------------------------------------------------

create function public.read_organization_telephony_credential(p_organization_id uuid)
returns table (
  account_sid     text,
  api_key_sid     text,
  api_key_secret  text,
  application_sid text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select b.external_account_id,
         k.external_id,
         (select d.decrypted_secret from vault.decrypted_secrets d where d.id = k.secret_id),
         a.external_id
    from public.organization_provider_bindings b
    join lateral (
      select r.external_id, r.secret_id
        from public.organization_provider_resources r
       where r.organization_id = b.organization_id
         and r.binding_id = b.id
         and r.resource_type = 'twilio_api_key'
         and r.status = 'active'
         and r.secret_id is not null
       order by r.created_at desc
       limit 1
    ) k on true
    join lateral (
      select r.external_id
        from public.organization_provider_resources r
       where r.organization_id = b.organization_id
         and r.binding_id = b.id
         and r.resource_type = 'twilio_twiml_app'
         and r.status = 'active'
       order by r.created_at desc
       limit 1
    ) a on true
   where b.organization_id = p_organization_id
     and b.provider_key = 'twilio'
     and b.status = 'active'
     and b.external_account_id is not null;
$fn$;

comment on function public.read_organization_telephony_credential(uuid) is
  'One business''s own calling account, key and application, decrypted, for provider_operator and nobody else. Never GildOps'' parent credential.';

revoke all on function public.read_organization_telephony_credential(uuid) from public, anon, authenticated;
grant execute on function public.read_organization_telephony_credential(uuid) to provider_operator;

-- ---------------------------------------------------------------------------
-- 3. Whether the person asking may use this business's telephone
-- ---------------------------------------------------------------------------

-- Answered under the person's own token, so the runtime that holds the credential never decides
-- who a person is. Holding a telephone (so a call can ring it) takes membership; placing or
-- controlling a call takes `call.place`, the same capability every call command already checks.
create function public.telephony_caller(p_organization_id uuid, p_places_calls boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_membership uuid;
begin
  if p_organization_id not in (select app.current_tenant_ids()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_places_calls and not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  select m.id into v_membership
    from public.memberships m
   where m.organization_id = p_organization_id
     and m.user_id = (select auth.uid());

  if v_membership is null then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return v_membership;
end;
$fn$;

comment on function public.telephony_caller(uuid, boolean) is
  'The asking person''s own membership in this business, or a refusal. With p_places_calls it also requires call.place.';

revoke all on function public.telephony_caller(uuid, boolean) from public, anon;
grant execute on function public.telephony_caller(uuid, boolean) to authenticated;
