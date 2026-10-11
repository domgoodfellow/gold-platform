-- A business is more than a name and a clock: it is a legal and trading identity, a place, and a
-- way to be reached. Nothing here is public. `organizations` is readable by a public session bound
-- to the business (it carries the booking slug), and `organization_profiles` is published on
-- purpose, so a private address cannot live on either. This table has a member policy and no
-- external one.

create table public.organization_identity (
  organization_id uuid primary key references public.organizations (id) on delete cascade,

  legal_name      text check (legal_name is null or length(btrim(legal_name)) between 1 and 200),
  industry        text check (industry is null or length(btrim(industry)) between 1 and 100),

  country_code    text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  region          text check (region is null or length(btrim(region)) between 1 and 100),
  city            text check (city is null or length(btrim(city)) between 1 and 100),
  postal_code     text check (postal_code is null or length(btrim(postal_code)) between 1 and 20),
  address_line1   text check (address_line1 is null or length(btrim(address_line1)) between 1 and 200),
  address_line2   text check (address_line2 is null or length(btrim(address_line2)) between 1 and 100),

  contact_email   text check (contact_email is null or length(btrim(contact_email)) between 3 and 200),
  contact_phone   text check (contact_phone is null or length(btrim(contact_phone)) between 3 and 50),
  website_url     text check (website_url is null or length(btrim(website_url)) between 4 and 300),

  updated_at      timestamptz not null default now(),
  updated_by      uuid        not null references auth.users (id)
);

comment on table public.organization_identity is
  'A business''s private identity: legal name, industry, structured primary address and general contact details. The primary address is the business''s own location -- not a dispatch location, a billing address or anything published. What is published is organization_profiles, which a business fills deliberately.';

alter table public.organization_identity enable row level security;
alter table public.organization_identity force row level security;

create policy organization_identity_select on public.organization_identity
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy organization_identity_insert on public.organization_identity
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and updated_by = (select auth.uid())
    and app.has_capability(organization_id, 'organization.manage')
  );

create policy organization_identity_update on public.organization_identity
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

grant select, insert on public.organization_identity to authenticated;
grant update (legal_name, industry, country_code, region, city, postal_code, address_line1,
              address_line2, contact_email, contact_phone, website_url, updated_at, updated_by)
  on public.organization_identity to authenticated;

create function public.set_organization_identity(
  p_organization_id uuid,
  p_legal_name      text,
  p_industry        text,
  p_country_code    text,
  p_region          text,
  p_city            text,
  p_postal_code     text,
  p_address_line1   text,
  p_address_line2   text,
  p_contact_email   text,
  p_contact_phone   text,
  p_website_url     text
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'set_organization_identity requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Empty means unset, as it does on the public profile: a business clearing its legal name is
  -- saying something, and '' would read as a name.
  insert into public.organization_identity as i
    (organization_id, legal_name, industry, country_code, region, city, postal_code,
     address_line1, address_line2, contact_email, contact_phone, website_url, updated_by)
  values (
    p_organization_id,
    nullif(btrim(p_legal_name), ''),
    nullif(btrim(p_industry), ''),
    nullif(upper(btrim(p_country_code)), ''),
    nullif(btrim(p_region), ''),
    nullif(btrim(p_city), ''),
    nullif(btrim(p_postal_code), ''),
    nullif(btrim(p_address_line1), ''),
    nullif(btrim(p_address_line2), ''),
    nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_website_url), ''),
    v_actor
  )
  on conflict (organization_id) do update
    set legal_name    = excluded.legal_name,
        industry      = excluded.industry,
        country_code  = excluded.country_code,
        region        = excluded.region,
        city          = excluded.city,
        postal_code   = excluded.postal_code,
        address_line1 = excluded.address_line1,
        address_line2 = excluded.address_line2,
        contact_email = excluded.contact_email,
        contact_phone = excluded.contact_phone,
        website_url   = excluded.website_url,
        updated_at    = now(),
        updated_by    = excluded.updated_by
  where i.organization_id in (select app.current_tenant_ids());

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'organization.identity_updated',
     jsonb_build_object('country_code', nullif(upper(btrim(p_country_code)), ''),
                        'region', nullif(btrim(p_region), ''),
                        'city', nullif(btrim(p_city), '')));
end;
$fn$;

revoke all on function public.set_organization_identity(uuid, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.set_organization_identity(uuid, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Founding a business records where it is in the same transaction
-- ---------------------------------------------------------------------------

-- Recreated in full because an applied migration is never edited. The one change from
-- `20260910000002` is `p_identity`: the location the founder gave, written in the same statement
-- sequence as the business, so there is no second request that could fail and leave a business
-- with a name and no place. The old six-argument form is dropped; a call that names six arguments
-- still resolves, because `p_identity` has a default.
drop function public.create_organization(text, text, text[], text, text, text);

create function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text default null,
  p_identity     jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  if coalesce((select u.is_anonymous from auth.users u where u.id = v_actor), true) then
    raise exception 'an anonymous session may not create an organization'
      using errcode = '42501';
  end if;

  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  perform app.grant_founding_terms(v_org, v_actor);

  if p_identity is not null then
    insert into public.organization_identity
      (organization_id, industry, country_code, region, city, postal_code, updated_by)
    values (
      v_org,
      nullif(btrim(p_identity ->> 'industry'), ''),
      nullif(upper(btrim(p_identity ->> 'countryCode')), ''),
      nullif(btrim(p_identity ->> 'region'), ''),
      nullif(btrim(p_identity ->> 'city'), ''),
      nullif(btrim(p_identity ->> 'postalCode'), ''),
      v_actor
    );
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency
     ));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[], text, text, text, jsonb) from public;
grant execute on function public.create_organization(text, text, text[], text, text, text, jsonb) to authenticated;

comment on function public.create_organization(text, text, text[], text, text, text, jsonb) is
  'Found a business as the caller, with its role, membership, founding terms and -- when given -- the location and industry the founder stated, all in one transaction.';

-- ---------------------------------------------------------------------------
-- Asking GildOps for help
-- ---------------------------------------------------------------------------

-- A request from a business's operator to the platform provider. It is not a Support case (that
-- is a tenant serving its own customers) and it grants GildOps staff nothing: a platform support
-- session remains the only way in. Members write and read their own requests; platform staff read.
create table public.platform_support_requests (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  requested_by    uuid        not null references auth.users (id),
  subject         text        not null check (length(btrim(subject)) between 1 and 200),
  message         text        not null check (length(btrim(message)) between 1 and 5000),
  page            text        check (page is null or length(page) <= 300),
  status          text        not null default 'open' check (status in ('open', 'closed')),
  created_at      timestamptz not null default now()
);

comment on table public.platform_support_requests is
  'A business operator asking GildOps for help. Provider-owned intake: carries who asked, for which business and about which page -- never tenant records, credentials or anything the requester did not type.';

create index platform_support_requests_org_idx on public.platform_support_requests (organization_id, created_at desc);

alter table public.platform_support_requests enable row level security;
alter table public.platform_support_requests force row level security;

create policy platform_support_requests_select_own on public.platform_support_requests
  for select to authenticated
  using (requested_by = (select auth.uid()) and organization_id in (select app.current_tenant_ids()));

create policy platform_support_requests_select_staff on public.platform_support_requests
  for select to authenticated
  using (app.is_platform_staff());

create policy platform_support_requests_insert on public.platform_support_requests
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and organization_id in (select app.current_tenant_ids())
  );

grant select, insert on public.platform_support_requests to authenticated;

create function public.contact_gildops_support(
  p_organization_id uuid,
  p_subject         text,
  p_message         text,
  p_page            text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'contact_gildops_support requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.platform_support_requests
    (organization_id, requested_by, subject, message, page)
  values
    (p_organization_id, v_actor, btrim(p_subject), btrim(p_message), nullif(btrim(p_page), ''))
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.contact_gildops_support(uuid, text, text, text) from public;
grant execute on function public.contact_gildops_support(uuid, text, text, text) to authenticated;
