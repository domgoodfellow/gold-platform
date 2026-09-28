-- An organization reached by a hostname: GildOps' own address for it, and a domain it owns.
--
-- **Two kinds of hostname, and only one of them is a row.** The GildOps-managed address is
-- `{organizations.slug}.{platform_settings.platform_public_domain}` — computed on read, never
-- stored. `organizations.slug` is already globally unique and null until a business chooses one
-- (`20260829000005`), so the platform never invents a public name: until the business sets a slug,
-- it has no GildOps address at all. A row here would be a second copy of the slug that drifts the
-- first time a business renames itself. A **custom** domain is different in kind: the business
-- claims a name GildOps does not own, a provider has to be told, DNS has to be proven, and every
-- one of those facts has a lifecycle. That is `organization_domains`.
--
-- **The provider is Vercel, and it is a platform provider (D62), not a per-tenant account.**
-- GildOps holds one Vercel account (`platform_provider_accounts`, provider_key `vercel`); a
-- tenant's domain is attached to GildOps' one project beneath it. The per-organization plumbing
-- reuses the D44 pair exactly as `record_organization_email_domain` does for Resend: a binding
-- that is `active` from its first moment (there is no subaccount to provision) and one
-- `vercel_domain` resource per registered hostname, holding the DNS records the provider asked for
-- in its safe `config`.
--
-- **Who may write what.** A tenant with `organization.manage` names a hostname, chooses which of
-- its hostnames is primary, and releases one — three `security definer` doors, tenant-gated inline
-- like `record_organization_email_domain`, because the table grants no write to anybody. Whether a
-- hostname is registered, configured or verified is the provider's answer, recorded only by the
-- runtime that asked it: `provider_operator`, which only `apps/api` can wear (D54). A tenant cannot
-- mark its own domain verified, and neither can a staff member from a browser console.
--
-- **Resolution fails closed.** `hostname_binding` answers a normalized Host value for a managed
-- slug or a verified, unreleased custom domain, and nothing else: an unknown, pending, failed or
-- released hostname is an empty result, never a hint that it is almost valid. It never accepts an
-- organization id (D17).

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

insert into public.platform_providers (key, label) values ('vercel', 'Vercel') on conflict (key) do nothing;

-- A new resource type is a new value in a closed list; the list's name is the one Postgres gave
-- it in `20260912000001`, confirmed against the local stack before this was written.
alter table public.organization_provider_resources
  drop constraint organization_provider_resources_resource_type_check;
alter table public.organization_provider_resources
  add constraint organization_provider_resources_resource_type_check check (resource_type in (
    'twilio_subaccount',
    'twilio_api_key',
    'twilio_twiml_app',
    'twilio_phone_number',
    'resend_domain',
    'resend_sender_identity',
    'vercel_domain'
  ));

-- The target half of the composite reference `organization_domains` makes (I18) is already held:
-- `organization_provider_resources_org_id_unique unique (organization_id, id)`, from
-- `20260922000002`. A second index with the same key columns and predicate would be dead weight,
-- not a stronger guarantee.

-- The zone GildOps' managed addresses live under (`gildops.app`, say). Set by hand, once per
-- deployment, exactly as `workflow_review_organization_id` is (D42): a migration cannot know which
-- domain a deployment owns. Null means this deployment offers no managed address, which is a
-- state the Domains page says out loud rather than filling in.
alter table public.platform_settings
  add column platform_public_domain text
    constraint platform_settings_public_domain_shape
    check (platform_public_domain is null
           or platform_public_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$');

-- ---------------------------------------------------------------------------
-- A custom domain
-- ---------------------------------------------------------------------------

create table public.organization_domains (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references public.organizations (id) on delete cascade,

  -- citext so two spellings of one name can never both be claimed; stored lowercased and trimmed
  -- anyway, which the check below holds, so a text comparison agrees with the index.
  hostname             extensions.citext not null,

  -- Which public surface this hostname opens. Closed and small, like the homepage section kinds:
  -- a third surface is a new value and a new branch in `hostname_binding`, never free text.
  surface              text        not null check (surface in ('website', 'portal')),
  is_primary           boolean     not null default false,

  -- Three facts the provider answers, kept apart because they move independently: whether the
  -- name is proven and served (verification), whether DNS points where it must (configuration),
  -- and whether a certificate exists (ssl).
  verification_state   text        not null default 'pending'
                                    check (verification_state in ('pending', 'verifying', 'verified', 'failed')),
  configuration_state  text        not null default 'dns_required'
                                    check (configuration_state in ('dns_required', 'satisfied')),
  ssl_state            text        not null default 'pending'
                                    check (ssl_state in ('pending', 'issued', 'failed')),

  provider_key         text        not null default 'vercel' references public.platform_providers (key),
  provider_resource_id uuid,

  last_checked_at      timestamptz,
  -- GildOps' own vocabulary for what went wrong (`provider_unavailable`, `hostname_unavailable`,
  -- `provider_refused`, `malformed_response`), and the provider's own words beside it (D56: health
  -- is the provider's words, never this platform's paraphrase).
  error_code           text        check (error_code is null or error_code ~ '^[a-z][a-z_]{1,59}$'),
  error_message        text        check (error_message is null or length(error_message) <= 500),

  -- Audited soft release: a released hostname stops resolving and frees the name for anybody,
  -- and the row stays so "who let go of this, and when" is answerable.
  released_at          timestamptz,
  released_by          uuid        references auth.users (id),

  created_by           uuid        not null references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint organization_domains_hostname_shape check (
    hostname::text = lower(btrim(hostname::text))
    and hostname::text ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    and length(hostname::text) <= 253
  ),
  -- The provider, never a client boolean, is what verifies: a verified row names the resource the
  -- provider registered.
  constraint organization_domains_verified_needs_resource check (
    verification_state <> 'verified' or provider_resource_id is not null
  ),
  constraint organization_domains_release_is_attributed check ((released_at is null) = (released_by is null)),
  constraint organization_domains_released_is_not_primary check (released_at is null or not is_primary),

  foreign key (organization_id, provider_resource_id)
    references public.organization_provider_resources (organization_id, id)
);

comment on table public.organization_domains is
  'A hostname a business owns and has connected to one of its public surfaces. The GildOps-managed address is not a row: it is organizations.slug under platform_settings.platform_public_domain. Tenant writes go through begin_custom_domain_connection, set_primary_custom_domain and release_custom_domain; provider facts only through provider_operator.';

-- **An exception to I2, and the same one the portal token and the invitation hash are.** A
-- hostname is an identifier the outside world *presents* — a browser arrives with it and no
-- tenant in hand — so it must be unique across every tenant, or two businesses could both claim
-- `shop.example.com` and resolution would have to pick one. Only an unreleased claim counts, so a
-- released name is free again. `schema-conformance.test.ts` names this index individually.
create unique index organization_domains_active_hostname_unique
  on public.organization_domains (hostname)
  where released_at is null;

-- One primary hostname per surface per business, structurally rather than by every writer
-- remembering. Leads with organization_id (I2).
create unique index organization_domains_one_primary
  on public.organization_domains (organization_id, surface)
  where released_at is null and is_primary;

create index organization_domains_organization_idx
  on public.organization_domains (organization_id, created_at);

alter table public.organization_domains enable row level security;
alter table public.organization_domains force  row level security;

create policy organization_domains_select on public.organization_domains
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy organization_domains_select_staff on public.organization_domains
  for select to authenticated
  using ((select app.is_platform_staff()));

-- Supabase's default privileges leave REFERENCES and TRIGGER behind; nothing here needs them.
-- Every column is named rather than granting the table, so a column added later is withheld until
-- somebody decides otherwise. No insert, update or delete to anyone: the doors below are the writes.
revoke all on public.organization_domains from public, anon, authenticated;
grant select (
  id, organization_id, hostname, surface, is_primary, verification_state, configuration_state,
  ssl_state, provider_key, provider_resource_id, last_checked_at, error_code, error_message,
  released_at, released_by, created_by, created_at, updated_at
) on public.organization_domains to authenticated;

-- ---------------------------------------------------------------------------
-- The Catalogue seam
-- ---------------------------------------------------------------------------

-- `domain_binding` names the Resend sending domain. A site hostname is a second, separate Feature
-- beside it. `partial`: connecting, verifying and resolving exist, and a tenant's own published
-- site does not yet (a site is provisioned for GildOps alone, `20260916000005`).
insert into public.platform_catalog_features
  (module_id, key, label, description, implementation_state, packaging_default, display_order)
select m.id, 'custom_domain', 'Custom domain',
       'A hostname the business owns, verified through GildOps'' hosting provider and resolved to a public surface.',
       'partial', 'optional', 3
  from public.platform_catalog_modules m
 where m.key = 'brand_domains'
on conflict (module_id, key) do nothing;

insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
select f.id, 'kernel', 'organization_domains', 'Custom-domain lifecycle and hostname resolution. Entitlement is checked and recorded, not enforced (M17).'
  from public.platform_catalog_features f
  join public.platform_catalog_modules m on m.id = f.module_id
 where m.key = 'brand_domains' and f.key = 'custom_domain';

-- ---------------------------------------------------------------------------
-- Resolution: the one place a hostname becomes an organization
-- ---------------------------------------------------------------------------

-- Private: no grant. Both public readers below call it as its owner, so "what does this host
-- mean" has one answer rather than one per reader.
create function app.resolve_hostname(p_hostname text)
returns table (organization_id uuid, surface text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_host   text := rtrim(lower(btrim(coalesce(p_hostname, ''))), '.');
  v_zone   text;
  v_slug   text;
begin
  if v_host = '' then
    return;
  end if;

  select ps.platform_public_domain into v_zone from public.platform_settings ps where ps.singleton;

  -- A GildOps-managed address: one label, then the zone. Always the website surface in this
  -- slice; a managed portal address is a later decision, not a guess made here.
  if v_zone is not null and right(v_host, length(v_zone) + 1) = '.' || v_zone then
    v_slug := left(v_host, length(v_host) - length(v_zone) - 1);
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
      return;
    end if;
    return query
      select o.id, 'website'::text from public.organizations o where o.slug = v_slug;
    return;
  end if;

  return query
    select d.organization_id, d.surface
      from public.organization_domains d
     where d.hostname operator(extensions.=) v_host::extensions.citext
       and d.released_at is null
       and d.verification_state = 'verified';
end;
$fn$;

revoke all on function app.resolve_hostname(text) from public, anon, authenticated;

create function public.hostname_binding(p_hostname text)
returns table (organization_id uuid, surface text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.organization_id, r.surface from app.resolve_hostname(p_hostname) r;
$fn$;

comment on function public.hostname_binding(text) is
  'A Host value to the organization and surface it opens, for a managed slug address or a verified, unreleased custom domain. Empty for anything else. Accepts no organization id (D17).';

revoke all on function public.hostname_binding(text) from public;
grant execute on function public.hostname_binding(text) to anon, authenticated;

-- What a resolved hostname renders, read in one step so the page never holds an organization id
-- the URL supplied. The homepage projection is `published_gold_homepage`'s shape, for any
-- organization with a published home page; the portal surface carries only the business's own
-- public profile, because the portal itself is reached by an invitation token (`/portal/{token}`).
create function public.published_hostname_site(p_hostname text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'surface', r.surface,
    'profile', jsonb_build_object(
      'displayName', coalesce(op.display_name, o.name), 'tagline', op.tagline, 'intro', op.intro,
      'contactEmail', op.contact_email, 'contactPhone', op.contact_phone, 'address', op.address),
    'home', case when r.surface <> 'website' then null else (
      select jsonb_build_object(
        'siteId', s.id, 'organizationId', s.organization_id, 'pageId', p.id, 'revisionId', rv.id,
        'revisionNumber', rv.revision_number, 'seoTitle', rv.seo_title, 'seoDescription', rv.seo_description,
        'sections', rv.sections,
        'profile', jsonb_build_object('displayName', coalesce(op.display_name, o.name), 'tagline', op.tagline,
          'intro', op.intro, 'contactEmail', op.contact_email, 'contactPhone', op.contact_phone, 'address', op.address),
        'brand', jsonb_build_object('accent', b.accent, 'headingFont', coalesce(b.heading_font, 'sans'),
          'bodyFont', coalesce(b.body_font, 'sans'), 'logoPath', b.logo_path))
        from public.public_sites s
        join public.public_pages p on p.organization_id = s.organization_id and p.site_id = s.id and p.page_key = 'home'
        join public.public_page_revisions rv on rv.organization_id = p.organization_id and rv.page_id = p.id
             and rv.id = p.current_published_revision_id and rv.status = 'published'
        left join public.brand_settings b on b.organization_id = s.organization_id
       where s.organization_id = r.organization_id) end)
    from app.resolve_hostname(p_hostname) r
    join public.organizations o on o.id = r.organization_id
    left join public.organization_profiles op on op.organization_id = o.id
   limit 1;
$fn$;

comment on function public.published_hostname_site(text) is
  'What a resolved hostname renders: its surface, the business''s own public profile, and for the website surface its published home page (null when none is published). Null for a hostname that resolves to nothing.';

revoke all on function public.published_hostname_site(text) from public;
grant execute on function public.published_hostname_site(text) to anon, authenticated;

-- The zone itself is not a secret — it is in every managed address a business hands out — and it
-- is the one column of `platform_settings` a signed-in member may learn, so the Domains page can
-- show the address its slug produces. The rest of that table stays unreadable (D42).
create function public.platform_public_domain()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select ps.platform_public_domain from public.platform_settings ps where ps.singleton;
$fn$;

revoke all on function public.platform_public_domain() from public, anon;
grant execute on function public.platform_public_domain() to authenticated;

-- ---------------------------------------------------------------------------
-- The tenant's doors
-- ---------------------------------------------------------------------------

-- `apps/api` asks this under the caller's own token before it touches the provider, the same
-- shape as `can_manage_integrations`: RLS and the capability answer, not the runtime.
create function public.can_manage_custom_domains(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_organization_id in (select app.current_tenant_ids())
     and app.has_capability(p_organization_id, 'organization.manage');
$fn$;

revoke all on function public.can_manage_custom_domains(uuid) from public, anon;
grant execute on function public.can_manage_custom_domains(uuid) to authenticated;

create function public.begin_custom_domain_connection(
  p_organization_id uuid,
  p_hostname        text,
  p_surface         text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_host      text := rtrim(lower(btrim(coalesce(p_hostname, ''))), '.');
  v_zone      text;
  v_account   uuid;
  v_entitled  boolean;
  v_id        uuid;
begin
  if v_actor is null then
    raise exception 'begin_custom_domain_connection requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  if v_host = '' or length(v_host) > 253
     or v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'not a hostname this platform can connect' using errcode = '22023';
  end if;

  if p_surface is null or p_surface not in ('website', 'portal') then
    raise exception 'unknown surface: %', p_surface using errcode = '22023';
  end if;

  -- GildOps' own zone is not a custom domain anybody can claim: its addresses come from a slug.
  select ps.platform_public_domain into v_zone from public.platform_settings ps where ps.singleton;
  if v_zone is not null and (v_host = v_zone or right(v_host, length(v_zone) + 1) = '.' || v_zone) then
    raise exception 'that address belongs to GildOps; choose a public name in General settings instead'
      using errcode = '22023';
  end if;

  -- Claimed by an unreleased row anywhere — this business's or another's. Checked here so the
  -- caller gets one distinct refusal, and held by the partial unique index regardless; nothing
  -- about the other claim is selected into a variable, let alone returned.
  if exists (
    select 1 from public.organization_domains d
     where d.hostname operator(extensions.=) v_host::extensions.citext and d.released_at is null
  ) then
    raise exception 'that hostname is already connected' using errcode = '23505';
  end if;

  -- Checked and recorded, not enforced: the canonical Feature is `partial`, so a Product grant does
  -- not cover it, and M17 owns turning this answer into a refusal (CLAUDE.md, Current state).
  select exists (
    select 1
      from public.organization_effective_entitlements(p_organization_id) e
      join public.platform_catalog_features f on f.id = e.feature_id
      join public.platform_catalog_modules m on m.id = f.module_id
     where m.key = 'brand_domains' and f.key = 'custom_domain'
  ) into v_entitled;

  -- The binding is `active` from its first moment, Resend's shape: there is no per-tenant
  -- account at the provider to create, only a name to attach beneath GildOps' own project. It is
  -- placed under the provider's default account when one exists, and never moved afterwards.
  select a.id into v_account
    from public.platform_provider_accounts a
   where a.provider_key = 'vercel' and a.status = 'active' and a.is_default;

  insert into public.organization_provider_bindings
    (organization_id, provider_key, status, provider_account_id)
  values
    (p_organization_id, 'vercel', 'active', v_account)
  on conflict (organization_id, provider_key) do update
    set provider_account_id = coalesce(public.organization_provider_bindings.provider_account_id, excluded.provider_account_id),
        updated_at = now();

  begin
    insert into public.organization_domains
      (organization_id, hostname, surface, provider_key, created_by)
    values
      (p_organization_id, v_host, p_surface, 'vercel', v_actor)
    returning id into v_id;
  exception when unique_violation then
    -- Two callers racing for the same name: the index decided, and the loser hears the same
    -- refusal as above.
    raise exception 'that hostname is already connected' using errcode = '23505';
  end;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.custom_domain_requested',
     jsonb_build_object('domain_id', v_id, 'hostname', v_host, 'surface', p_surface,
                        'custom_domain_entitled', v_entitled));

  return v_id;
end;
$fn$;

comment on function public.begin_custom_domain_connection(uuid, text, text) is
  'A business naming a hostname it owns for one of its public surfaces. Starts pending; the provider registration and every verification fact are recorded by provider_operator. Refuses a hostname any unreleased row already claims with SQLSTATE 23505 and nothing else.';

revoke all on function public.begin_custom_domain_connection(uuid, text, text) from public, anon;
grant execute on function public.begin_custom_domain_connection(uuid, text, text) to authenticated;

create function public.set_primary_custom_domain(p_organization_id uuid, p_domain_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor   uuid := (select auth.uid());
  v_surface text;
begin
  if v_actor is null then
    raise exception 'set_primary_custom_domain requires an authenticated caller' using errcode = '42501';
  end if;

  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  select d.surface into v_surface
    from public.organization_domains d
   where d.id = p_domain_id and d.organization_id = p_organization_id
     and d.released_at is null and d.verification_state = 'verified';

  if v_surface is null then
    -- The same refusal for "not yours", "released" and "not verified yet": a primary address is
    -- one that already answers, and a caller learns nothing about a row it cannot see.
    raise exception 'only a verified domain of this business can be primary' using errcode = '22023';
  end if;

  update public.organization_domains
     set is_primary = false, updated_at = now()
   where organization_id = p_organization_id and surface = v_surface
     and released_at is null and is_primary and id <> p_domain_id;

  update public.organization_domains
     set is_primary = true, updated_at = now()
   where id = p_domain_id and organization_id = p_organization_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.custom_domain_primary_set', jsonb_build_object('domain_id', p_domain_id));
end;
$fn$;

revoke all on function public.set_primary_custom_domain(uuid, uuid) from public, anon;
grant execute on function public.set_primary_custom_domain(uuid, uuid) to authenticated;

create function public.release_custom_domain(p_organization_id uuid, p_domain_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_resource uuid;
  v_host     text;
begin
  if v_actor is null then
    raise exception 'release_custom_domain requires an authenticated caller' using errcode = '42501';
  end if;

  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  update public.organization_domains
     set released_at = now(), released_by = v_actor, is_primary = false, updated_at = now()
   where id = p_domain_id and organization_id = p_organization_id and released_at is null
  returning provider_resource_id, hostname::text into v_resource, v_host;

  if v_host is null then
    raise exception 'no such domain' using errcode = '42501';
  end if;

  -- The provider-side record stays, disabled, so history keeps what was registered.
  if v_resource is not null then
    update public.organization_provider_resources
       set status = 'disabled', updated_at = now()
     where id = v_resource and organization_id = p_organization_id;
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.custom_domain_released', jsonb_build_object('domain_id', p_domain_id, 'hostname', v_host));
end;
$fn$;

comment on function public.release_custom_domain(uuid, uuid) is
  'Releases one of this business''s hostnames: it stops resolving and the name is free again. Soft — the row stays, attributed. Never deletes.';

revoke all on function public.release_custom_domain(uuid, uuid) from public, anon;
grant execute on function public.release_custom_domain(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The runtime's doors (provider_operator only)
-- ---------------------------------------------------------------------------

-- Which GildOps account answers for this business's domains: the one its binding was placed
-- under, else today's default. `apps/api` cannot read `platform_provider_accounts` (staff-only
-- RLS) or the binding's account column (withheld from tenants), and must not be able to.
create function public.custom_domain_provider_account(p_organization_id uuid, p_domain_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select b.provider_account_id
       from public.organization_domains d
       join public.organization_provider_bindings b
         on b.organization_id = d.organization_id and b.provider_key = d.provider_key
       join public.platform_provider_accounts a on a.id = b.provider_account_id and a.status = 'active'
      where d.id = p_domain_id and d.organization_id = p_organization_id),
    (select a.id
       from public.platform_provider_accounts a
       join public.organization_domains d on d.id = p_domain_id and d.organization_id = p_organization_id
      where a.provider_key = d.provider_key and a.status = 'active' and a.is_default)
  );
$fn$;

revoke all on function public.custom_domain_provider_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.custom_domain_provider_account(uuid, uuid) to provider_operator;

create function app.valid_dns_records(p_records jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_typeof(p_records) = 'array'
     and jsonb_array_length(p_records) <= 10
     and not exists (
       select 1 from jsonb_array_elements(p_records) r
        where jsonb_typeof(r) <> 'object'
           or coalesce(r ->> 'type', '') not in ('A', 'AAAA', 'CNAME', 'TXT')
           or length(coalesce(r ->> 'name', '')) not between 1 and 253
           or length(coalesce(r ->> 'value', '')) not between 1 and 500
     );
$fn$;

revoke all on function app.valid_dns_records(jsonb) from public, anon, authenticated;

-- Called once the provider has actually been asked to attach the hostname. With no error, the
-- provider accepted it: the `vercel_domain` resource is recorded (idempotently, by hostname) with
-- the DNS records the provider asked for, and the domain moves to `verifying`. With an error, the
-- attempt is recorded on the row — a failure is durable state, never only a toast (D44).
create function public.record_custom_domain_registration(
  p_organization_id     uuid,
  p_domain_id           uuid,
  p_configuration_state text,
  p_dns_records         jsonb,
  p_error_code          text default null,
  p_error_message       text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_host     text;
  v_binding  uuid;
  v_resource uuid;
begin
  if p_configuration_state not in ('dns_required', 'satisfied') then
    raise exception 'unknown configuration state: %', p_configuration_state using errcode = '22023';
  end if;
  if not app.valid_dns_records(coalesce(p_dns_records, '[]'::jsonb)) then
    raise exception 'dns records must be a short array of {type, name, value}' using errcode = '22023';
  end if;

  select d.hostname::text into v_host
    from public.organization_domains d
   where d.id = p_domain_id and d.organization_id = p_organization_id and d.released_at is null;
  if v_host is null then
    raise exception 'no such domain' using errcode = '22023';
  end if;

  if p_error_code is not null then
    update public.organization_domains
       set error_code = p_error_code, error_message = left(p_error_message, 500),
           last_checked_at = now(), updated_at = now()
     where id = p_domain_id and organization_id = p_organization_id;
    return null;
  end if;

  select b.id into v_binding
    from public.organization_provider_bindings b
   where b.organization_id = p_organization_id and b.provider_key = 'vercel';
  if v_binding is null then
    raise exception 'no binding for this organization and provider' using errcode = '22023';
  end if;

  insert into public.organization_provider_resources
    (organization_id, binding_id, resource_type, external_id, status, config)
  values
    (p_organization_id, v_binding, 'vercel_domain', v_host, 'pending',
     jsonb_build_object('dns_records', coalesce(p_dns_records, '[]'::jsonb)))
  on conflict (organization_id, resource_type, external_id) do update
    set status = 'pending', config = excluded.config, updated_at = now()
  returning id into v_resource;

  update public.organization_domains
     set provider_resource_id = v_resource,
         configuration_state  = p_configuration_state,
         verification_state   = case when verification_state = 'verified' then verification_state else 'verifying' end,
         error_code = null, error_message = null,
         last_checked_at = now(), updated_at = now()
   where id = p_domain_id and organization_id = p_organization_id;

  return v_resource;
end;
$fn$;

comment on function public.record_custom_domain_registration(uuid, uuid, text, jsonb, text, text) is
  'What the provider said when apps/api asked it to attach a hostname. provider_operator only: a tenant or staff token cannot claim a registration that did not happen.';

revoke all on function public.record_custom_domain_registration(uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_custom_domain_registration(uuid, uuid, text, jsonb, text, text) to provider_operator;

-- Called after every recheck. Idempotent: the same answer twice leaves the same row. `verified`
-- is refused by the table's own check unless a registration recorded a resource first.
create function public.set_custom_domain_verification(
  p_organization_id     uuid,
  p_domain_id           uuid,
  p_verification_state  text,
  p_configuration_state text default null,
  p_ssl_state           text default null,
  p_dns_records         jsonb default null,
  p_error_code          text default null,
  p_error_message       text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_resource uuid;
  v_found    boolean;
begin
  if p_verification_state not in ('pending', 'verifying', 'verified', 'failed') then
    raise exception 'unknown verification state: %', p_verification_state using errcode = '22023';
  end if;
  if p_configuration_state is not null and p_configuration_state not in ('dns_required', 'satisfied') then
    raise exception 'unknown configuration state: %', p_configuration_state using errcode = '22023';
  end if;
  if p_ssl_state is not null and p_ssl_state not in ('pending', 'issued', 'failed') then
    raise exception 'unknown certificate state: %', p_ssl_state using errcode = '22023';
  end if;
  if p_dns_records is not null and not app.valid_dns_records(p_dns_records) then
    raise exception 'dns records must be a short array of {type, name, value}' using errcode = '22023';
  end if;

  update public.organization_domains
     set verification_state  = p_verification_state,
         configuration_state = coalesce(p_configuration_state, configuration_state),
         ssl_state           = coalesce(p_ssl_state, ssl_state),
         error_code          = p_error_code,
         error_message       = left(p_error_message, 500),
         last_checked_at     = now(),
         updated_at          = now()
   where id = p_domain_id and organization_id = p_organization_id and released_at is null
  returning provider_resource_id, true into v_resource, v_found;

  if v_found is null then
    raise exception 'no such domain' using errcode = '22023';
  end if;

  if v_resource is not null then
    update public.organization_provider_resources
       set status = case p_verification_state when 'verified' then 'active' when 'failed' then 'failed' else 'pending' end,
           config = case when p_dns_records is null then config
                         else jsonb_set(config, '{dns_records}', p_dns_records) end,
           last_verified_at = case when p_verification_state = 'verified' then now() else last_verified_at end,
           updated_at = now()
     where id = v_resource and organization_id = p_organization_id;
  end if;
end;
$fn$;

comment on function public.set_custom_domain_verification(uuid, uuid, text, text, text, jsonb, text, text) is
  'What the provider said on a recheck. provider_operator only, for the reason record_provider_account_verification is: only the runtime that asked may say what the answer was.';

revoke all on function public.set_custom_domain_verification(uuid, uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.set_custom_domain_verification(uuid, uuid, text, text, text, jsonb, text, text) to provider_operator;
