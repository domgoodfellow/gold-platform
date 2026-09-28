-- A phone number's origin, and the audit gap Work Order 2 found and Work Order 3 asks to close
-- for the one function that actually writes `phone_numbers` today.
--
-- `provider_resource_id not null` said, by construction, that every number this platform will
-- ever hold is one GOLD itself provisioned. That was true of the one writer that existed
-- (`sync_phone_number`, staff-only, always fed a `twilio_phone_number` resource) and stops being
-- true the day this platform reads an externally-owned identity, a browser/device identity with
-- no telephone number at all, or a future SIP endpoint — none of which GOLD created a provider
-- resource for. The column stays required for the one origin that has a resource; every other
-- origin has none, honestly.

alter table public.phone_numbers
  alter column provider_resource_id drop not null;

alter table public.phone_numbers
  add column origin text not null default 'provisioned'
    check (origin in ('provisioned', 'external', 'browser', 'sip'));

comment on column public.phone_numbers.origin is
  'Who this identity belongs to, not who dialled it. provisioned: GOLD created it at the carrier and holds the resource. external: a number this business already owned, taken as an outbound identity where the carrier allows it. browser: an internal calling endpoint, never presented as a public number. sip: reserved — no writer exists yet (no BYOC in this slice).';

-- The one class with a resource keeps needing one; every other class has none to name.
alter table public.phone_numbers
  add constraint phone_numbers_provisioned_has_a_resource
    check (origin != 'provisioned' or provider_resource_id is not null);

-- ---------------------------------------------------------------------------
-- The audit gap: `created_by` already existed on this table and nothing set it
-- ---------------------------------------------------------------------------

create or replace function public.sync_phone_number(
  p_organization_id uuid,
  p_provider_resource_id uuid,
  p_e164 text,
  p_label text default null,
  p_status text default 'active'
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid := auth.uid();
begin
  perform app.require_platform_staff();
  if not exists (
    select 1 from public.organization_provider_resources
     where organization_id = p_organization_id and id = p_provider_resource_id and resource_type = 'twilio_phone_number'
  ) then
    raise exception 'provider resource is not a phone number in this organization' using errcode = '23503';
  end if;
  insert into public.phone_numbers (organization_id, provider_resource_id, e164, label, lifecycle, created_by)
    values (p_organization_id, p_provider_resource_id, p_e164, nullif(btrim(p_label), ''), p_status, v_actor)
    on conflict (organization_id, e164) do update
      set provider_resource_id = excluded.provider_resource_id, label = excluded.label, lifecycle = excluded.lifecycle, updated_at = now()
    returning id into v_id;
  return v_id;
end $$;
