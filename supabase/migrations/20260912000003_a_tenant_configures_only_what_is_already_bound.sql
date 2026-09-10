-- Two separate facts, kept separate: what belongs to a business, and what it chose.
--
-- **The provider resource** is `organization_provider_resources`: "this E.164 number belongs to
-- this organization's Twilio scope." **The tenant configuration** is `telephony_settings`: "this
-- organization picked this owned number as its default outbound identity." They stay two tables.
-- What changes here is that the second may now name only something the first already lists —
-- `set_calling_number` cannot be edited in place (D15), so it is recreated with the same
-- signature and one more check.
--
-- **A real change, named rather than hidden, and deliberately the narrowest one that satisfies
-- it.** Before this file, `calling_number` accepted any string matching the E.164 shape, because
-- nothing yet recorded which numbers belonged to which business. A number nobody has ever bound
-- to any organization stays exactly as free-text-settable as it always was — most businesses on
-- this deployment have provisioned nothing yet, and inventing a requirement to bind before
-- dialling would be a second slice's work, not this one's. What changes is narrower and absolute:
-- a number that *is* recorded as some organization's bound resource may only ever be chosen by
-- that same organization.
--
-- **Why the ownership check is its own `security definer` function.** `set_calling_number` stays
-- `security invoker` — it adds no authority beyond `telephony_settings_insert`/`_update`, exactly
-- as before. But an invoker-mode query against `organization_provider_resources` runs under the
-- *caller's own* RLS, which shows only that caller's own rows — so a plain `select` here could
-- never see that a number belongs to somebody else, and would let every cross-tenant number
-- through by simply failing to notice it was taken. This one lookup needs to see every
-- organization's resources to answer *is this claimed, and by whom* — the same reason
-- `app.has_capability` and `app.current_tenant_ids()` are themselves `security definer`.
create function app.phone_number_owner(p_number text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select organization_id
  from public.organization_provider_resources
  where resource_type = 'twilio_phone_number'
    and external_id = p_number
  limit 1;
$fn$;

create or replace function public.set_calling_number(p_organization_id uuid, p_number text)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_number   text := nullif(btrim(p_number), '');
  v_owner_id uuid;
begin
  if v_actor is null then
    raise exception 'set_calling_number requires an authenticated caller'
      using errcode = '42501';
  end if;

  if v_number is not null then
    v_owner_id := app.phone_number_owner(v_number);

    if v_owner_id is not null and v_owner_id <> p_organization_id then
      -- Named plainly rather than folded into a generic "invalid number": this is a different
      -- refusal from the shape check the domain layer already does, and the two must stay
      -- distinguishable for the sentence a caller sees.
      raise exception 'that number belongs to a different organization''s telephony scope'
        using errcode = '22023';
    end if;
  end if;

  insert into public.telephony_settings as t
    (organization_id, calling_number, updated_by)
  values (p_organization_id, v_number, v_actor)
  on conflict (organization_id) do update
    set calling_number = excluded.calling_number,
        updated_by     = excluded.updated_by
  where t.organization_id in (select app.current_tenant_ids());

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.calling_number_set',
     jsonb_build_object('calling_number', v_number));
end;
$fn$;

comment on function public.set_calling_number(uuid, text) is
  'One write path and one event for the number a business dials from. security invoker: telephony_settings_insert/update decide. Now refuses any number not among this organization''s own bound resources, once it has at least one.';

revoke all on function public.set_calling_number(uuid, text) from public;
grant execute on function public.set_calling_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A tenant's own choice of sending domain — Resend, the shared-account provider
-- ---------------------------------------------------------------------------

-- Unlike Twilio, Resend has no per-tenant subaccount to provision: GOLD holds one platform
-- account, and what a business owns beneath it is a sending domain (or a sender identity).
-- Naming that domain is the business's own decision — the same shape as `set_calling_number` —
-- so this is a tenant door, `security invoker`-equivalent in spirit even though the two backing
-- tables carry no grant to authenticated at all yet, which is why it is `security definer`: the
-- authority is the same capability check `telephony_settings_insert` already runs, done in
-- plpgsql because there is no policy here to lean on.
create function public.record_organization_email_domain(
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

  -- GOLD holds one Resend account; every organization's binding to it is `active` from the
  -- first moment, unlike Twilio's provisioning lifecycle — there is no external account to
  -- create, only a domain to name beneath GOLD's existing one.
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
    set updated_at = now()
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
  'A business naming its own sending domain beneath GOLD''s one Resend account. Starts at pending — verification is recorded separately by staff via set_provider_resource_status until a real Resend-facing check exists.';

revoke all on function public.record_organization_email_domain(uuid, text) from public;
grant execute on function public.record_organization_email_domain(uuid, text) to authenticated;
