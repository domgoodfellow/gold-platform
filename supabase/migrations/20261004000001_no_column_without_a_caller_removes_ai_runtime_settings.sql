-- `platform_ai_runtime_assignments.settings` had no caller. Removed rather than left as an
-- invitation: the repository's own rule is no column or abstraction without a caller in the same
-- change, and this one arrived speculatively, ahead of any adapter actually reading a runtime
-- setting. `app.ai.runtime` resolves `provider_key`, `provider_service_key`, `provider_account_id`
-- and `model` alone; nothing calls `record_ai_runtime_assignment` with a settings argument today.
--
-- When a real adapter needs a typed runtime setting, add a typed column for it then -- not a bare
-- `jsonb` bucket revived for the occasion.

drop function public.platform_ai_runtime_assignment_overview();
drop function public.record_ai_runtime_assignment(text, uuid, uuid, text, jsonb);

alter table public.platform_ai_runtime_assignments drop column settings;

create function public.record_ai_runtime_assignment(
  p_capability          text,
  p_provider_service_id uuid,
  p_provider_account_id uuid,
  p_model               text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff        text := app.require_platform_staff();
  v_service_key  text;
  v_service_provider  text;
  v_implemented  text;
  v_account_provider  text;
  v_account_status    text;
  v_account_secret    uuid;
begin
  if p_capability not in ('operator_assistant', 'public_assistant') then
    raise exception 'unknown AI capability: %', p_capability using errcode = '22023';
  end if;

  if btrim(coalesce(p_model, '')) = '' or length(p_model) > 200 then
    raise exception 'a model is required' using errcode = '22023';
  end if;

  select key, provider_key, implementation_state
    into v_service_key, v_service_provider, v_implemented
    from public.platform_provider_services
   where id = p_provider_service_id;

  if v_service_key is null then
    raise exception 'no such provider service' using errcode = '22023';
  end if;
  if v_implemented <> 'available' then
    raise exception 'that provider service has no runtime implementation yet' using errcode = '22023';
  end if;

  select provider_key, status, secret_id
    into v_account_provider, v_account_status, v_account_secret
    from public.platform_provider_accounts
   where id = p_provider_account_id;

  if v_account_provider is null then
    raise exception 'no such provider account' using errcode = '22023';
  end if;
  if v_account_provider <> v_service_provider then
    raise exception 'that provider account belongs to a different provider than the service' using errcode = '22023';
  end if;
  if v_account_status <> 'active' then
    raise exception 'that provider account is not active' using errcode = '22023';
  end if;
  if v_account_secret is null then
    raise exception 'that provider account has no credential stored' using errcode = '22023';
  end if;

  insert into public.platform_ai_runtime_assignments
    (capability, provider_service_id, provider_account_id, model, updated_at, updated_by)
  values
    (p_capability, p_provider_service_id, p_provider_account_id, btrim(p_model), now(), auth.uid())
  on conflict (capability) do update
    set provider_service_id = excluded.provider_service_id,
        provider_account_id = excluded.provider_account_id,
        model                = excluded.model,
        updated_at           = now(),
        updated_by           = auth.uid();
end;
$fn$;

comment on function public.record_ai_runtime_assignment(text, uuid, uuid, text) is
  'Assigns, or reassigns, which Provider Service, Provider Account and model answers one AI capability. Refuses a service with no runtime implementation, a provider/account mismatch, or an inactive or uncredentialed account. Deliberately does NOT require verification_state = ''verified'': a freshly-stored credential is unverified by default (store_provider_account_credential resets it), and requiring a successful verify() call first would make Verify a mandatory two-step dance before an assignment could ever be tested end to end. Verification is diagnostic evidence about a credential a staff member reads before assigning it, not a gate this function enforces -- an assignment against an unverified account is a decision staff are trusted to make, and a subsequently-failing execution surfaces as an ordinary failed run (app.ai.runtime never fails over), not a silent success.';

revoke all on function public.record_ai_runtime_assignment(text, uuid, uuid, text) from public, anon;
grant execute on function public.record_ai_runtime_assignment(text, uuid, uuid, text) to authenticated;

create function public.platform_ai_runtime_assignment_overview()
returns table (
  capability           text,
  provider_service_id  uuid,
  provider_key         text,
  provider_service_key text,
  provider_service_label text,
  provider_account_id  uuid,
  provider_account_label text,
  model                text,
  updated_at           timestamptz
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
  select a.capability, a.provider_service_id, s.provider_key, s.key, s.label,
         a.provider_account_id, act.label, a.model, a.updated_at
    from public.platform_ai_runtime_assignments a
    join public.platform_provider_services s on s.id = a.provider_service_id
    join public.platform_provider_accounts act on act.id = a.provider_account_id
   order by a.capability;
end;
$fn$;

comment on function public.platform_ai_runtime_assignment_overview() is
  'Every current AI runtime assignment, joined to the labels a staff screen needs. Never the credential.';

revoke all on function public.platform_ai_runtime_assignment_overview() from public, anon;
grant execute on function public.platform_ai_runtime_assignment_overview() to authenticated;
