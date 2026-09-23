-- Which Provider Service, Provider Account and model answers one AI capability.
--
-- **The catalogue was never wired to anything that runs.** `platform_provider_services` (Slice
-- 4) describes what GOLD could implement; `platform_provider_accounts` (prior migration) holds a
-- credential. Neither told `apps/api`'s AI loop which one to use, or with which model -- that
-- runtime read `ANTHROPIC_API_KEY` from process environment and answered with a name hardcoded in
-- source. This is the row that closes the gap: one assignment per capability, GOLD-owned and
-- platform-wide, with no `organization_id` -- a tenant bringing its own model key is D33's axis
-- and a different feature with a different record.
--
-- **Nobody may read this table directly, staff included.** The pattern is `organization_commercial_terms`'s:
-- the row underneath a decision is not the decision's own visibility. Staff read it through
-- `platform_ai_runtime_assignment_overview`, which joins in the labels a screen needs; `apps/api`
-- reads it through `resolve_ai_runtime_assignment`, granted to `provider_operator` alone -- the same
-- machine role that already reads a provider account's credential, so resolving an assignment
-- costs no new secret and no new axis of trust.
--
-- **Assignment is refused, not merely hidden, when it would not run.** A service the catalogue has
-- not marked `available`, an account for a different provider, a disabled or uncredentialed
-- account, or a blank model are each a validation error at the one write door -- never something
-- left for the UI to have hidden well enough.

create table public.platform_ai_runtime_assignments (
  capability          text        primary key check (capability in ('operator_assistant', 'public_assistant')),
  provider_service_id uuid        not null references public.platform_provider_services (id),
  provider_account_id uuid        not null references public.platform_provider_accounts (id),
  model               text        not null check (length(btrim(model)) between 1 and 200),
  settings            jsonb       not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at          timestamptz not null default now(),
  updated_by          uuid        references auth.users (id)
);

comment on table public.platform_ai_runtime_assignments is
  'One row per AI capability GOLD has actually assigned a runtime to. Platform-wide (no organization_id), like platform_staff. No policy selects this table directly -- see platform_ai_runtime_assignment_overview and resolve_ai_runtime_assignment.';

alter table public.platform_ai_runtime_assignments enable row level security;
alter table public.platform_ai_runtime_assignments force  row level security;

-- Deliberately no policy and no grant of any kind to any role. A capability having, or not
-- having, an assigned runtime is not a fact this table's own row-level security ever answers --
-- the two functions below are the only doors, exactly as `organization_commercial_terms` has none
-- either.

-- ---------------------------------------------------------------------------
-- Writing an assignment (staff)
-- ---------------------------------------------------------------------------

create function public.record_ai_runtime_assignment(
  p_capability          text,
  p_provider_service_id uuid,
  p_provider_account_id uuid,
  p_model               text,
  p_settings            jsonb default '{}'::jsonb
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

  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'settings must be a JSON object' using errcode = '22023';
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
    (capability, provider_service_id, provider_account_id, model, settings, updated_at, updated_by)
  values
    (p_capability, p_provider_service_id, p_provider_account_id, btrim(p_model), coalesce(p_settings, '{}'::jsonb), now(), auth.uid())
  on conflict (capability) do update
    set provider_service_id = excluded.provider_service_id,
        provider_account_id = excluded.provider_account_id,
        model                = excluded.model,
        settings             = excluded.settings,
        updated_at           = now(),
        updated_by           = auth.uid();
end;
$fn$;

comment on function public.record_ai_runtime_assignment(text, uuid, uuid, text, jsonb) is
  'Assigns, or reassigns, which Provider Service, Provider Account and model answers one AI capability. Refuses a service with no runtime implementation, a provider/account mismatch, or an inactive or uncredentialed account.';

revoke all on function public.record_ai_runtime_assignment(text, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.record_ai_runtime_assignment(text, uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading assignments (staff, for the AI Runtime screen)
-- ---------------------------------------------------------------------------

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
  settings             jsonb,
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
         a.provider_account_id, act.label, a.model, a.settings, a.updated_at
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

-- ---------------------------------------------------------------------------
-- Resolving an assignment (the machine role apps/api already holds)
-- ---------------------------------------------------------------------------

-- Granted to `provider_operator` alone -- the same role `read_provider_account_credential`
-- already trusts apps/api to hold. A capability with no assignment returns no row; the caller's
-- own fallback (an environment-configured default) is `apps/api`'s decision, not this function's.
create function public.resolve_ai_runtime_assignment(p_capability text)
returns table (
  provider_key         text,
  provider_service_key text,
  provider_account_id  uuid,
  model                text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select s.provider_key, s.key, a.provider_account_id, a.model
    from public.platform_ai_runtime_assignments a
    join public.platform_provider_services s on s.id = a.provider_service_id
   where a.capability = p_capability;
$fn$;

comment on function public.resolve_ai_runtime_assignment(text) is
  'What apps/api resolves before answering a question: the provider, the service it implements, the account to read a credential from, and the model. No row means no assignment -- the caller falls back to its own deployment default.';

revoke all on function public.resolve_ai_runtime_assignment(text) from public, anon, authenticated;
grant execute on function public.resolve_ai_runtime_assignment(text) to provider_operator;
