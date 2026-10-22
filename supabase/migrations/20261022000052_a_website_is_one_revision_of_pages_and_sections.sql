-- A website is one revision of many pages, and publishing selects one revision.
--
-- Until now a site had one page, `home`, and each page had its own revisions: publishing
-- "the website" meant publishing one page. With several pages that shape would let a visitor see
-- navigation from one revision, a home page from another and a services page from a third, each
-- published independently. The unit of review and publication is therefore the SITE REVISION:
-- every page, every section, the navigation, as one validated snapshot. `public_sites` points at
-- the one published snapshot, and publishing moves that single pointer in one transaction, so a
-- stranger can only ever read one coherent website (docs/constraints.md D88).
--
-- Pages and sections keep a stable id inside the snapshot. A slug is a path, never an identity:
-- navigation names a page by id, so renaming `/services` cannot break a link. The vocabulary
-- stays closed — a registered kind, bounded text, a link that stays inside the website; no HTML,
-- component name, script or arbitrary URL — and this migration's validator is authoritative for
-- every writer, with TypeScript repeating it only for better error messages.
--
-- The old per-page tables are backfilled into site revisions (same ids, same numbers, same
-- statuses) and dropped, so an existing site renders equivalently without manual intervention.

-- ---------------------------------------------------------------------------
-- The vocabulary
-- ---------------------------------------------------------------------------

-- Single-segment paths that already mean something on a business's hostname. A page may not
-- take one: the hostname rewrite would otherwise shadow a form, the portal or an API.
-- `apps/web/lib/domain/public-site/paths.ts` repeats this list for the proxy; a test compares them.
create function app.public_site_reserved_slugs()
returns text[] language sql immutable set search_path = '' as $fn$
  select array['forms','f','embed','portal','book','proposal','preview','api','auth','connect',
               'organizations','platform','settings','sites','login','sign-up','forgot-password',
               'reset-password','sign-in','sign-out','workflow-review']::text[];
$fn$;

create function app.public_text_ok(p_item jsonb, p_key text, p_min integer, p_max integer)
returns boolean language sql immutable set search_path = '' as $fn$
  select jsonb_typeof(p_item -> p_key) = 'string'
    and length(case when p_min > 0 then btrim(p_item ->> p_key) else p_item ->> p_key end) between p_min and p_max;
$fn$;

create function app.public_optional_link_ok(p_item jsonb, p_key text)
returns boolean language sql immutable set search_path = '' as $fn$
  select not (p_item ? p_key) or app.public_link_is_valid(p_item -> p_key);
$fn$;

-- Why a section is not valid, or null when it is. One branch per registered kind: adding a kind
-- is adding a branch here, a Zod schema, a registry definition, a renderer and an editor.
create function app.public_section_problem(p_item jsonb)
returns text language plpgsql immutable set search_path = '' as $fn$
declare v_kind text;
begin
  if jsonb_typeof(p_item) <> 'object' then return 'a section must be an object'; end if;
  if coalesce(p_item ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'every section needs an id';
  end if;
  v_kind := p_item ->> 'kind';

  if v_kind = 'hero' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','variant','eyebrow','heading','body','primaryCta','secondaryCta'])
        and coalesce(p_item ->> 'variant', '') in ('centered','left','preview')
        and app.public_text_ok(p_item,'eyebrow',0,100) and app.public_text_ok(p_item,'heading',1,160)
        and app.public_text_ok(p_item,'body',1,600) and app.public_link_is_valid(p_item -> 'primaryCta')
        and app.public_optional_link_ok(p_item,'secondaryCta')) then
      return 'a hero section does not match the supported fields';
    end if;
  elsif v_kind = 'problem' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','heading','paragraphs'])
        and app.public_text_ok(p_item,'heading',1,240) and jsonb_typeof(p_item -> 'paragraphs') = 'array'
        and jsonb_array_length(p_item -> 'paragraphs') between 1 and 4
        and not exists (select 1 from jsonb_array_elements(p_item -> 'paragraphs') q
                         where jsonb_typeof(q) <> 'string' or length(btrim(q #>> '{}')) not between 1 and 600)) then
      return 'a problem section does not match the supported fields';
    end if;
  elsif v_kind = 'content' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','eyebrow','heading','paragraphs'])
        and app.public_text_ok(p_item,'eyebrow',0,100) and app.public_text_ok(p_item,'heading',1,240)
        and jsonb_typeof(p_item -> 'paragraphs') = 'array' and jsonb_array_length(p_item -> 'paragraphs') between 1 and 6
        and not exists (select 1 from jsonb_array_elements(p_item -> 'paragraphs') q
                         where jsonb_typeof(q) <> 'string' or length(btrim(q #>> '{}')) not between 1 and 800)) then
      return 'a content section does not match the supported fields';
    end if;
  elsif v_kind = 'capabilities' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','eyebrow','heading','body','items'])
        and app.public_text_ok(p_item,'eyebrow',0,100) and app.public_text_ok(p_item,'heading',1,240)
        and app.public_text_ok(p_item,'body',1,600) and app.public_text_items_are_valid(p_item -> 'items', 9)) then
      return 'a capabilities section does not match the supported fields';
    end if;
  elsif v_kind = 'process' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','eyebrow','heading','items'])
        and app.public_text_ok(p_item,'eyebrow',0,100) and app.public_text_ok(p_item,'heading',1,240)
        and app.public_process_items_are_valid(p_item -> 'items')) then
      return 'a process section does not match the supported fields';
    end if;
  elsif v_kind = 'trust' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','eyebrow','heading','items'])
        and app.public_text_ok(p_item,'eyebrow',0,100) and app.public_text_ok(p_item,'heading',1,240)
        and app.public_text_items_are_valid(p_item -> 'items', 6)) then
      return 'a trust section does not match the supported fields';
    end if;
  elsif v_kind = 'cta' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','heading','body','primaryCta','secondaryCta'])
        and app.public_text_ok(p_item,'heading',1,240) and app.public_text_ok(p_item,'body',1,600)
        and app.public_link_is_valid(p_item -> 'primaryCta') and app.public_optional_link_ok(p_item,'secondaryCta')) then
      return 'a closing action section does not match the supported fields';
    end if;
  elsif v_kind = 'form' then
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','heading','body','formId'])
        and app.public_text_ok(p_item,'heading',1,240) and app.public_text_ok(p_item,'body',0,600)
        and jsonb_typeof(p_item -> 'formId') = 'string'
        and (p_item ->> 'formId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      return 'a form section does not match the supported fields';
    end if;
  else
    return 'that kind of section is not supported';
  end if;
  return null;
end;
$fn$;

-- Why a whole site's content is not valid, or null when it is. Pure structure: whether a named
-- form exists is the revision trigger's question, because it reads a table.
create function app.public_site_content_problem(p_pages jsonb, p_navigation jsonb)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  v_page jsonb; v_section jsonb; v_item jsonb; v_problem text; v_homes integer := 0;
  v_slug text; v_slugs text[] := '{}'; v_ids text[] := '{}'; v_page_ids text[] := '{}'; v_id text;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) not between 1 and 50 then
    return 'a website holds between 1 and 50 pages';
  end if;
  if jsonb_typeof(p_navigation) <> 'array' or jsonb_array_length(p_navigation) > 20 then
    return 'navigation holds at most 20 items';
  end if;

  for v_page in select value from jsonb_array_elements(p_pages) loop
    if not app.jsonb_has_only_keys(v_page, array['id','name','slug','isHome','seoTitle','seoDescription','sections']) then
      return 'a page does not match the supported fields';
    end if;
    v_id := v_page ->> 'id';
    if coalesce(v_id, '') !~ v_uuid then return 'every page needs an id'; end if;
    if v_id = any(v_page_ids) then return 'two pages share an id'; end if;
    v_page_ids := v_page_ids || v_id;
    if not (app.public_text_ok(v_page,'name',1,80) and app.public_text_ok(v_page,'seoTitle',1,70)
        and app.public_text_ok(v_page,'seoDescription',1,180)) then
      return 'a page needs a name, a title of at most 70 characters and a description of at most 180';
    end if;
    if jsonb_typeof(v_page -> 'isHome') <> 'boolean' then return 'a page must say whether it is the homepage'; end if;
    v_slug := v_page ->> 'slug';
    if jsonb_typeof(v_page -> 'slug') <> 'string' then return 'a page needs a path'; end if;
    if (v_page ->> 'isHome')::boolean then
      v_homes := v_homes + 1;
      if v_slug <> '' then return 'the homepage lives at the root and has no path of its own'; end if;
    else
      if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(v_slug) > 60 then
        return 'a page path is lowercase letters, numbers and hyphens';
      end if;
      if v_slug = any(app.public_site_reserved_slugs()) then return format('/%s is reserved by the platform', v_slug); end if;
      if v_slug = any(v_slugs) then return format('two pages share the path /%s', v_slug); end if;
      v_slugs := v_slugs || v_slug;
    end if;
    if jsonb_typeof(v_page -> 'sections') <> 'array' or jsonb_array_length(v_page -> 'sections') > 60 then
      return 'a page holds at most 60 sections';
    end if;
    for v_section in select value from jsonb_array_elements(v_page -> 'sections') loop
      v_problem := app.public_section_problem(v_section);
      if v_problem is not null then return v_problem; end if;
      if (v_section ->> 'id') = any(v_ids) then return 'two sections share an id'; end if;
      v_ids := v_ids || (v_section ->> 'id');
    end loop;
  end loop;
  if v_homes <> 1 then return 'a website has exactly one homepage'; end if;

  v_ids := '{}';
  for v_item in select value from jsonb_array_elements(p_navigation) loop
    if not (app.jsonb_has_only_keys(v_item, array['id','label','target'])
        and coalesce(v_item ->> 'id', '') ~ v_uuid and app.public_text_ok(v_item,'label',1,60)
        and jsonb_typeof(v_item -> 'target') = 'object') then
      return 'a navigation item needs an id, a label and a destination';
    end if;
    if (v_item ->> 'id') = any(v_ids) then return 'two navigation items share an id'; end if;
    v_ids := v_ids || (v_item ->> 'id');
    if v_item #>> '{target,type}' = 'page' then
      if not (app.jsonb_has_only_keys(v_item -> 'target', array['type','pageId'])
          and (v_item #>> '{target,pageId}') = any(v_page_ids)) then
        return 'navigation points at a page that does not exist';
      end if;
    elsif v_item #>> '{target,type}' = 'external' then
      if not (app.jsonb_has_only_keys(v_item -> 'target', array['type','href'])
          and coalesce(v_item #>> '{target,href}', '') ~ '^https://[^[:space:]<>"]{3,250}$') then
        return 'an external link must be a full https address';
      end if;
    else
      return 'a navigation destination is a page or an external link';
    end if;
  end loop;
  return null;
end;
$fn$;

revoke all on function app.public_site_reserved_slugs() from public, anon, authenticated;
revoke all on function app.public_text_ok(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function app.public_optional_link_ok(jsonb, text) from public, anon, authenticated;
revoke all on function app.public_section_problem(jsonb) from public, anon, authenticated;
revoke all on function app.public_site_content_problem(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The snapshot
-- ---------------------------------------------------------------------------

create table public.public_site_revisions (
  organization_id uuid not null,
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  revision_number integer not null check (revision_number > 0),
  status text not null check (status in ('draft', 'in_review', 'published', 'archived')),
  pages jsonb not null check (jsonb_typeof(pages) = 'array' and pg_column_size(pages) < 600000),
  navigation jsonb not null default '[]'::jsonb check (jsonb_typeof(navigation) = 'array'),
  created_source text not null check (created_source in ('migration', 'account')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  submitted_at timestamptz,
  submitted_by uuid references auth.users (id),
  published_at timestamptz,
  published_by uuid references auth.users (id),
  archived_at timestamptz,
  primary key (organization_id, site_id, id),
  foreign key (organization_id, site_id)
    references public.public_sites (organization_id, id) on delete cascade,
  unique (organization_id, site_id, revision_number),
  check ((created_source = 'migration' and created_by is null) or
         (created_source = 'account' and created_by is not null)),
  check ((status = 'draft' and submitted_at is null and published_at is null) or
         (status = 'in_review' and submitted_at is not null and published_at is null) or
         (status = 'published' and submitted_at is not null and published_at is not null) or
         (status = 'archived' and published_at is not null and archived_at is not null))
);

create unique index public_site_one_working_revision
  on public.public_site_revisions (organization_id, site_id) where status in ('draft', 'in_review');
create unique index public_site_one_published_revision
  on public.public_site_revisions (organization_id, site_id) where status = 'published';

alter table public.public_sites add column current_published_revision_id uuid;
alter table public.public_sites
  add constraint public_sites_published_revision_belongs_to_site
  foreign key (organization_id, id, current_published_revision_id)
  references public.public_site_revisions (organization_id, site_id, id);

comment on column public.public_sites.current_published_revision_id is
  'The one snapshot strangers read. Moved only by publish_public_site_revision, in the same transaction that archives the previous one: publishing is selecting one coherent website, never assembling pages published separately.';

alter table public.public_site_revisions enable row level security;
alter table public.public_site_revisions force row level security;
revoke all on public.public_site_revisions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: every existing page revision becomes a site revision with the same id
-- ---------------------------------------------------------------------------

-- Sections gain a stable id; the legacy hero is the one that drew the product preview, so it says
-- so explicitly rather than leaving an absent variant to mean something.
create function app.with_section_ids(p_sections jsonb)
returns jsonb language sql volatile set search_path = '' as $fn$
  select coalesce(jsonb_agg(
    (s.value || jsonb_build_object('id', gen_random_uuid()))
      || case when s.value ->> 'kind' = 'hero' and not (s.value ? 'variant') then jsonb_build_object('variant', 'preview') else '{}'::jsonb end
    order by s.ordinality), '[]'::jsonb)
  from jsonb_array_elements(p_sections) with ordinality s;
$fn$;

insert into public.public_site_revisions (
  organization_id, site_id, id, revision_number, status, pages, navigation, created_source,
  created_at, created_by, submitted_at, submitted_by, published_at, published_by, archived_at
)
select r.organization_id, p.site_id, r.id, r.revision_number, r.status,
  jsonb_build_array(jsonb_build_object(
    'id', p.id, 'name', 'Home', 'slug', '', 'isHome', true,
    'seoTitle', r.seo_title, 'seoDescription', r.seo_description,
    'sections', app.with_section_ids(r.sections))),
  '[]'::jsonb, r.created_source, r.created_at, r.created_by, r.submitted_at, r.submitted_by,
  r.published_at, r.published_by, r.archived_at
from public.public_page_revisions r
join public.public_pages p on p.organization_id = r.organization_id and p.id = r.page_id and p.page_key = 'home';

update public.public_sites s
   set current_published_revision_id = p.current_published_revision_id
  from public.public_pages p
 where p.organization_id = s.organization_id and p.site_id = s.id and p.page_key = 'home'
   and p.current_published_revision_id is not null;

do $check$
declare v_bad text;
begin
  select app.public_site_content_problem(pages, navigation) into v_bad
    from public.public_site_revisions
   where app.public_site_content_problem(pages, navigation) is not null limit 1;
  if v_bad is not null then
    raise exception 'an existing website revision does not fit the page and section vocabulary: %', v_bad;
  end if;
end
$check$;

-- ---------------------------------------------------------------------------
-- Guard: content, form references, and immutability once published
-- ---------------------------------------------------------------------------

create function app.guard_public_site_revision()
returns trigger language plpgsql set search_path = '' as $fn$
declare v_problem text;
begin
  if tg_op = 'INSERT' or new.pages is distinct from old.pages or new.navigation is distinct from old.navigation then
    v_problem := app.public_site_content_problem(new.pages, new.navigation);
    if v_problem is not null then
      raise exception 'the website does not match the supported vocabulary: %', v_problem using errcode = '23514';
    end if;
    -- A section may only name a form this business owns and has not archived. It may still name
    -- one that is not published yet: the page then simply shows nothing in that place.
    if exists (
      select 1 from jsonb_path_query(new.pages, '$[*].sections[*] ? (@.kind == "form").formId') ref
       where not exists (
         select 1 from public.forms f
          where f.organization_id = new.organization_id and f.id = (ref #>> '{}')::uuid and f.archived_at is null)
    ) then
      raise exception 'the website names a form that does not exist in this organization' using errcode = '23503';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status in ('published', 'archived') and
     (new.pages is distinct from old.pages or new.navigation is distinct from old.navigation or
      new.revision_number is distinct from old.revision_number or
      new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by) then
    raise exception 'a published website revision is immutable' using errcode = '55000';
  end if;
  return new;
end;
$fn$;

create trigger public_site_revision_guard
before insert or update on public.public_site_revisions
for each row execute function app.guard_public_site_revision();

create function app.prevent_published_site_revision_delete()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if old.status in ('published', 'archived') then
    raise exception 'a published website revision is immutable' using errcode = '55000';
  end if;
  return old;
end;
$fn$;

create trigger public_site_published_revision_cannot_be_deleted
before delete on public.public_site_revisions
for each row execute function app.prevent_published_site_revision_delete();

-- ---------------------------------------------------------------------------
-- The old per-page model goes; its readers are replaced below
-- ---------------------------------------------------------------------------

drop function public.public_homepage_editor_state(uuid);
drop function public.create_public_homepage_draft(uuid);
drop function public.update_public_homepage_draft(uuid, uuid, text, text, jsonb);
drop function public.submit_public_homepage_revision(uuid, uuid);
drop function public.publish_public_homepage_revision(uuid, uuid);
drop function public.public_homepage_preview(uuid, uuid);
drop table public.public_page_revisions cascade;
drop table public.public_pages;
drop function app.guard_public_page_revision();
drop function app.prevent_published_revision_delete();
drop function app.public_homepage_sections_are_valid(jsonb);
drop function app.public_homepage_core_sections_are_valid(jsonb);
drop function app.public_form_section_is_valid(jsonb);
drop function app.website_form_projections(uuid, jsonb);

-- The published forms a website's pages name, keyed by form id, read from the form and never from
-- the website. An unpublished, archived or foreign form is simply not in the map.
create function app.website_form_projections(p_organization_id uuid, p_pages jsonb)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_object_agg(p.f_id, p.projection), '{}'::jsonb)
  from (
    select f.id::text as f_id, app.form_projection(f.id) as projection
    from public.forms f
    where f.organization_id = p_organization_id
      and f.id in (select (ref #>> '{}')::uuid
                     from jsonb_path_query(p_pages, '$[*].sections[*] ? (@.kind == "form").formId') ref)
  ) p
  where p.projection is not null;
$fn$;
revoke all on function app.website_form_projections(uuid, jsonb) from public, anon, authenticated;

create function app.public_site_snapshot(p_organization_id uuid, p_revision_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'siteId', r.site_id, 'organizationId', r.organization_id, 'revisionId', r.id,
    'revisionNumber', r.revision_number, 'status', r.status,
    'pages', r.pages, 'navigation', r.navigation,
    'forms', app.website_form_projections(r.organization_id, r.pages),
    'profile', jsonb_build_object('displayName', coalesce(op.display_name, o.name), 'tagline', op.tagline,
      'intro', op.intro, 'contactEmail', op.contact_email, 'contactPhone', op.contact_phone, 'address', op.address),
    'brand', jsonb_build_object('accent', b.accent, 'headingFont', coalesce(b.heading_font, 'sans'),
      'bodyFont', coalesce(b.body_font, 'sans'), 'logoPath', b.logo_path))
  from public.public_site_revisions r
  join public.organizations o on o.id = r.organization_id
  left join public.organization_profiles op on op.organization_id = o.id
  left join public.brand_settings b on b.organization_id = o.id
  where r.organization_id = p_organization_id and r.id = p_revision_id;
$fn$;
revoke all on function app.public_site_snapshot(uuid, uuid) from public, anon, authenticated;

-- The platform root still renders GildOps' own homepage: the home page of the published snapshot.
create or replace function public.published_gold_homepage()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'siteId', snap ->> 'siteId', 'organizationId', snap ->> 'organizationId', 'pageId', home ->> 'id',
    'revisionId', snap ->> 'revisionId', 'revisionNumber', (snap ->> 'revisionNumber')::integer,
    'seoTitle', home ->> 'seoTitle', 'seoDescription', home ->> 'seoDescription', 'sections', home -> 'sections',
    'forms', snap -> 'forms', 'profile', snap -> 'profile', 'brand', snap -> 'brand')
  from public.platform_settings ps
  join public.public_sites s on s.organization_id = ps.gold_public_organization_id and s.id = ps.gold_public_site_id
  cross join lateral (select app.public_site_snapshot(s.organization_id, s.current_published_revision_id) as snap) x
  cross join lateral (select h.value as home from jsonb_array_elements(x.snap -> 'pages') h
                       where (h.value ->> 'isHome')::boolean limit 1) y
  where ps.singleton and s.current_published_revision_id is not null;
$fn$;

-- A business's hostname: what it is, and — for a website — the whole published snapshot. The page
-- for a path is chosen from it by the caller, so one read cannot mix revisions.
create or replace function public.published_hostname_site(p_hostname text)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'surface', r.surface,
    'profile', jsonb_build_object(
      'displayName', coalesce(op.display_name, o.name), 'tagline', op.tagline, 'intro', op.intro,
      'contactEmail', op.contact_email, 'contactPhone', op.contact_phone, 'address', op.address),
    'site', case when r.surface <> 'website' then null else (
      select app.public_site_snapshot(s.organization_id, s.current_published_revision_id)
        from public.public_sites s
       where s.organization_id = r.organization_id and s.current_published_revision_id is not null) end)
    from app.resolve_hostname(p_hostname) r
    join public.organizations o on o.id = r.organization_id
    left join public.organization_profiles op on op.organization_id = o.id
   limit 1;
$fn$;

create or replace function public.public_assistant_deployment(p_site_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('deploymentId', d.id, 'organizationId', d.organization_id, 'displayName', d.display_name,
    'greeting', d.greeting, 'instructions', a.instructions, 'handoffMessage', d.handoff_message)
  from public.ai_assistant_deployments d
  join public.ai_assistants a on a.organization_id = d.organization_id and a.id = d.assistant_id
  join public.public_sites s on s.organization_id = d.organization_id and s.id = d.public_site_id
       and s.current_published_revision_id is not null
  where d.surface = 'website_chat' and d.public_site_id = p_site_id and d.enabled and a.status = 'active' limit 1;
$fn$;

create or replace function app.form_placements(p_organization_id uuid, p_form_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'websitePublished', exists (
      select 1 from public.public_site_revisions r
       where r.organization_id = p_organization_id and r.status = 'published'
         and jsonb_path_exists(r.pages, '$[*].sections[*] ? (@.kind == "form" && @.formId == $f)', jsonb_build_object('f', p_form_id::text))),
    'websiteDraft', exists (
      select 1 from public.public_site_revisions r
       where r.organization_id = p_organization_id and r.status in ('draft', 'in_review')
         and jsonb_path_exists(r.pages, '$[*].sections[*] ? (@.kind == "form" && @.formId == $f)', jsonb_build_object('f', p_form_id::text))),
    'portal', exists (select 1 from public.portal_forms pf where pf.organization_id = p_organization_id and pf.form_id = p_form_id),
    'booking', false);
$fn$;

-- ---------------------------------------------------------------------------
-- GildOps' own site: bootstrap from the shipped homepage copy
-- ---------------------------------------------------------------------------

create or replace function app.bootstrap_gold_public_site(p_organization_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_site uuid; v_revision uuid; v_published uuid;
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'the GOLD organization does not exist' using errcode = '23503';
  end if;

  insert into public.public_sites (organization_id, created_by) values (p_organization_id, null)
  on conflict (organization_id) do update set default_locale = public.public_sites.default_locale
  returning id, current_published_revision_id into v_site, v_published;

  if v_published is null then
    insert into public.public_site_revisions (
      organization_id, site_id, revision_number, status, pages, navigation, created_source, submitted_at, published_at
    ) values (
      p_organization_id, v_site,
      coalesce((select max(revision_number) from public.public_site_revisions where organization_id = p_organization_id and site_id = v_site), 0) + 1,
      'published',
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'name', 'Home', 'slug', '', 'isHome', true,
        'seoTitle', 'GildOps | Run your business from one connected system',
        'seoDescription', 'Sales, operations and customer service in one connected system, configured around how your business actually runs. Request a demo.',
        'sections', app.with_section_ids(app.default_gold_homepage_sections()))),
      '[]'::jsonb, 'migration', now(), now()
    ) returning id into v_revision;
    update public.public_sites set current_published_revision_id = v_revision
     where organization_id = p_organization_id and id = v_site;
  end if;

  update public.platform_settings set gold_public_organization_id = p_organization_id, gold_public_site_id = v_site
   where singleton;
  return v_site;
end;
$fn$;
revoke all on function app.bootstrap_gold_public_site(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starting points: typed platform artifacts, copied and never referenced
-- ---------------------------------------------------------------------------

-- Platform-owned, no organization_id, no grant, read only through the list functions below — the
-- same shape as `form_templates`. A business's own saved templates will be separate tenant tables.
-- Three typed tables rather than one `template_type` + `payload`: a site, a page and a section
-- are different artifacts with different validity.
create table public.public_site_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 300),
  category text not null check (length(btrim(category)) between 1 and 60),
  -- Pages without ids; navigation names a page by its `slug` ('' is the homepage). Ids are made
  -- when a business uses the template.
  pages jsonb not null,
  navigation jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.public_page_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 300),
  category text not null check (length(btrim(category)) between 1 and 60),
  -- One page without an id; a business gets its own copy, with fresh ids, when it adds the page.
  page jsonb not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.public_section_patterns (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 300),
  kind text not null check (kind in ('hero','problem','content','capabilities','process','trust','cta')),
  -- A section without an id. A pattern is a way to begin, never live inheritance.
  section jsonb not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.public_site_templates enable row level security;
alter table public.public_site_templates force row level security;
alter table public.public_page_templates enable row level security;
alter table public.public_page_templates force row level security;
alter table public.public_section_patterns enable row level security;
alter table public.public_section_patterns force row level security;
revoke all on public.public_site_templates from public, anon, authenticated;
revoke all on public.public_page_templates from public, anon, authenticated;
revoke all on public.public_section_patterns from public, anon, authenticated;

-- A copy with fresh ids, so two businesses (or two sites) never share an identity with a template
-- or with each other. Navigation in a template names pages by slug; the result names them by id.
create function app.rekey_site_content(p_pages jsonb, p_navigation jsonb)
returns jsonb language sql volatile set search_path = '' as $fn$
  with pg as (
    select p.value as page, p.ordinality as ord, gen_random_uuid() as new_id
    from jsonb_array_elements(p_pages) with ordinality p
  )
  select jsonb_build_object(
    'pages', (select coalesce(jsonb_agg(
        (pg.page - 'id') || jsonb_build_object('id', pg.new_id, 'sections', coalesce((
          select jsonb_agg((s.value - 'id') || jsonb_build_object('id', gen_random_uuid()) order by s.ordinality)
            from jsonb_array_elements(pg.page -> 'sections') with ordinality s), '[]'::jsonb))
        order by pg.ord), '[]'::jsonb) from pg),
    'navigation', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', gen_random_uuid(), 'label', n.value ->> 'label',
        'target', case when n.value #>> '{target,type}' = 'page'
          then jsonb_build_object('type', 'page', 'pageId',
                 (select pg.new_id from pg where pg.page ->> 'slug' = n.value #>> '{target,slug}'))
          else n.value -> 'target' end)
        order by n.ordinality), '[]'::jsonb)
      from jsonb_array_elements(p_navigation) with ordinality n));
$fn$;
revoke all on function app.rekey_site_content(jsonb, jsonb) from public, anon, authenticated;

insert into public.public_site_templates (key, name, description, category, display_order, pages, navigation) values
('local_service', 'Local service business', 'Home, Services, About and Contact for a business that does work at people''s addresses.', 'Service', 10,
$json$[
 {"name":"Home","slug":"","isHome":true,"seoTitle":"Home","seoDescription":"What we do, who we do it for, and how to reach us.","sections":[
  {"kind":"hero","variant":"centered","eyebrow":"Your trade, your town","heading":"Say in one sentence what you do and where.","body":"Replace this with the problem you solve for customers and why they should call you first.","primaryCta":{"label":"Get in touch","href":"/contact"},"secondaryCta":{"label":"See our services","href":"/services"}},
  {"kind":"capabilities","eyebrow":"Services","heading":"What we do","body":"Name the work customers most often ask for.","items":[{"title":"First service","body":"Describe it in a sentence a customer would use."},{"title":"Second service","body":"Describe it in a sentence a customer would use."},{"title":"Third service","body":"Describe it in a sentence a customer would use."}]},
  {"kind":"process","eyebrow":"How it works","heading":"From first call to finished job","items":[{"step":"01","title":"You get in touch","body":"Tell us what you need."},{"step":"02","title":"We agree the work","body":"A clear scope and price before we start."},{"step":"03","title":"We do the job","body":"On the day we said, to the standard we promised."}]},
  {"kind":"cta","heading":"Ready when you are.","body":"Tell us about the job and we will come back to you.","primaryCta":{"label":"Contact us","href":"/contact"}}]},
 {"name":"Services","slug":"services","isHome":false,"seoTitle":"Services","seoDescription":"The work we do and how we do it.","sections":[
  {"kind":"capabilities","eyebrow":"Services","heading":"The work we do","body":"One card for each kind of job.","items":[{"title":"First service","body":"What it is and who it is for."},{"title":"Second service","body":"What it is and who it is for."},{"title":"Third service","body":"What it is and who it is for."}]},
  {"kind":"cta","heading":"Not sure which you need?","body":"Describe the problem and we will tell you.","primaryCta":{"label":"Contact us","href":"/contact"}}]},
 {"name":"About","slug":"about","isHome":false,"seoTitle":"About","seoDescription":"Who we are and why we do this work.","sections":[
  {"kind":"content","eyebrow":"About us","heading":"Who we are","paragraphs":["Tell the story of the business in a few honest sentences.","Say who does the work and what customers can expect from them."]}]},
 {"name":"Contact","slug":"contact","isHome":false,"seoTitle":"Contact","seoDescription":"How to reach us.","sections":[
  {"kind":"content","eyebrow":"Contact","heading":"Get in touch","paragraphs":["Say how customers can reach you and when you reply. Add a form from Studio to take requests on this page."]}]}
]$json$::jsonb,
$json$[{"label":"Home","target":{"type":"page","slug":""}},{"label":"Services","target":{"type":"page","slug":"services"}},{"label":"About","target":{"type":"page","slug":"about"}},{"label":"Contact","target":{"type":"page","slug":"contact"}}]$json$::jsonb),
('professional_services', 'Professional services', 'A credibility-first site for an advisor, practice or agency: Home, Services and Contact.', 'Professional', 20,
$json$[
 {"name":"Home","slug":"","isHome":true,"seoTitle":"Home","seoDescription":"Who we help, how we work, and how to start.","sections":[
  {"kind":"hero","variant":"left","eyebrow":"","heading":"Name who you help and the outcome you deliver.","body":"One honest paragraph on the problem clients bring you and what changes once you have worked together.","primaryCta":{"label":"Book a conversation","href":"/contact"}},
  {"kind":"trust","eyebrow":"Why us","heading":"What clients can rely on","items":[{"title":"Experience","body":"Say what you have done and for whom."},{"title":"Clarity","body":"Say how you scope and price the work."},{"title":"Follow-through","body":"Say what happens after the engagement."}]},
  {"kind":"process","eyebrow":"Working together","heading":"How an engagement runs","items":[{"step":"01","title":"Conversation","body":"We learn what you need."},{"step":"02","title":"Proposal","body":"A written scope and fee."},{"step":"03","title":"Delivery","body":"Regular updates until it is done."}]},
  {"kind":"cta","heading":"Start with a conversation.","body":"Tell us what you are trying to achieve.","primaryCta":{"label":"Contact us","href":"/contact"}}]},
 {"name":"Services","slug":"services","isHome":false,"seoTitle":"Services","seoDescription":"What we offer and who it is for.","sections":[
  {"kind":"capabilities","eyebrow":"Services","heading":"What we offer","body":"Group what you sell into a few clear offers.","items":[{"title":"First offer","body":"Who it is for and what they get."},{"title":"Second offer","body":"Who it is for and what they get."}]}]},
 {"name":"Contact","slug":"contact","isHome":false,"seoTitle":"Contact","seoDescription":"How to start a conversation.","sections":[
  {"kind":"content","eyebrow":"Contact","heading":"Start a conversation","paragraphs":["Say how to reach you and what happens next. Add a form from Studio to take enquiries on this page."]}]}
]$json$::jsonb,
$json$[{"label":"Home","target":{"type":"page","slug":""}},{"label":"Services","target":{"type":"page","slug":"services"}},{"label":"Contact","target":{"type":"page","slug":"contact"}}]$json$::jsonb),
('simple_brochure', 'Simple brochure', 'A one-page introduction with a way to get in touch. The smallest site that is still a site.', 'General', 30,
$json$[
 {"name":"Home","slug":"","isHome":true,"seoTitle":"Home","seoDescription":"Who we are and how to reach us.","sections":[
  {"kind":"hero","variant":"centered","eyebrow":"","heading":"Introduce the business in one line.","body":"A short paragraph on what you do and who it is for.","primaryCta":{"label":"Contact us","href":"/contact"}},
  {"kind":"content","eyebrow":"About","heading":"A little more","paragraphs":["Say what makes the business different, in plain words."]},
  {"kind":"cta","heading":"Say hello.","body":"We would like to hear from you.","primaryCta":{"label":"Contact us","href":"/contact"}}]},
 {"name":"Contact","slug":"contact","isHome":false,"seoTitle":"Contact","seoDescription":"How to reach us.","sections":[
  {"kind":"content","eyebrow":"Contact","heading":"Get in touch","paragraphs":["Say how customers can reach you. Add a form from Studio to take messages on this page."]}]}
]$json$::jsonb,
$json$[{"label":"Home","target":{"type":"page","slug":""}},{"label":"Contact","target":{"type":"page","slug":"contact"}}]$json$::jsonb);

insert into public.public_page_templates (key, name, description, category, display_order, page) values
('about_page', 'About', 'Who the business is, in a few honest paragraphs.', 'Company', 10,
$json${"name":"About","slug":"about","isHome":false,"seoTitle":"About","seoDescription":"Who we are and why we do this work.","sections":[{"kind":"content","eyebrow":"About us","heading":"Who we are","paragraphs":["Tell the story of the business in a few honest sentences.","Say who does the work and what customers can expect."]},{"kind":"trust","eyebrow":"What we stand for","heading":"How we work","items":[{"title":"First principle","body":"Say what it means for a customer."},{"title":"Second principle","body":"Say what it means for a customer."}]}]}$json$::jsonb),
('services_page', 'Services', 'The work on offer, one card each, ending in a call to action.', 'Company', 20,
$json${"name":"Services","slug":"services","isHome":false,"seoTitle":"Services","seoDescription":"The work we do and how we do it.","sections":[{"kind":"capabilities","eyebrow":"Services","heading":"What we do","body":"One card for each kind of job.","items":[{"title":"First service","body":"What it is and who it is for."},{"title":"Second service","body":"What it is and who it is for."}]},{"kind":"cta","heading":"Not sure which you need?","body":"Describe the problem and we will tell you.","primaryCta":{"label":"Contact us","href":"/contact"}}]}$json$::jsonb),
('contact_page', 'Contact', 'How to reach the business, with room to add a form.', 'Company', 30,
$json${"name":"Contact","slug":"contact","isHome":false,"seoTitle":"Contact","seoDescription":"How to reach us.","sections":[{"kind":"content","eyebrow":"Contact","heading":"Get in touch","paragraphs":["Say how customers can reach you and when you reply."]}]}$json$::jsonb),
('landing_page', 'Landing page', 'One offer, how it works, and one action — for a campaign or a single service.', 'Campaign', 40,
$json${"name":"Landing page","slug":"offer","isHome":false,"seoTitle":"Our offer","seoDescription":"One clear offer and how to take it up.","sections":[{"kind":"hero","variant":"centered","eyebrow":"","heading":"State the offer in one line.","body":"Who it is for and what they get.","primaryCta":{"label":"Get started","href":"/contact"}},{"kind":"process","eyebrow":"How it works","heading":"Three steps","items":[{"step":"01","title":"First step","body":"What the customer does."},{"step":"02","title":"Second step","body":"What we do."},{"step":"03","title":"Third step","body":"What they get."}]},{"kind":"cta","heading":"Ready?","body":"Take the first step today.","primaryCta":{"label":"Get started","href":"/contact"}}]}$json$::jsonb);

insert into public.public_section_patterns (key, name, description, kind, display_order, section) values
('hero_centered', 'Centered headline', 'A headline, a sentence and one action, centered.', 'hero', 10,
$json${"kind":"hero","variant":"centered","eyebrow":"","heading":"Say what you do in one line.","body":"A short paragraph on who it is for and why it matters.","primaryCta":{"label":"Get in touch","href":"/contact"}}$json$::jsonb),
('hero_left', 'Left-aligned headline', 'The same message, aligned left, with a second action.', 'hero', 20,
$json${"kind":"hero","variant":"left","eyebrow":"Welcome","heading":"Say what you do in one line.","body":"A short paragraph on who it is for and why it matters.","primaryCta":{"label":"Get in touch","href":"/contact"},"secondaryCta":{"label":"Learn more","href":"#more"}}$json$::jsonb),
('capabilities_three', 'Three services', 'Three cards: what you offer and a line on each.', 'capabilities', 40,
$json${"kind":"capabilities","eyebrow":"Services","heading":"What we do","body":"One card for each kind of work.","items":[{"title":"First","body":"A sentence about it."},{"title":"Second","body":"A sentence about it."},{"title":"Third","body":"A sentence about it."}]}$json$::jsonb),
('process_steps', 'Steps', 'Numbered steps from first contact to finished work.', 'process', 50,
$json${"kind":"process","eyebrow":"How it works","heading":"Three simple steps","items":[{"step":"01","title":"First step","body":"What happens."},{"step":"02","title":"Second step","body":"What happens."},{"step":"03","title":"Third step","body":"What happens."}]}$json$::jsonb),
('trust_reasons', 'Reasons to choose us', 'Three short reasons a customer can rely on.', 'trust', 60,
$json${"kind":"trust","eyebrow":"Why us","heading":"What you can rely on","items":[{"title":"First reason","body":"Say it plainly."},{"title":"Second reason","body":"Say it plainly."},{"title":"Third reason","body":"Say it plainly."}]}$json$::jsonb),
('cta_close', 'Get in touch banner', 'A dark banner that closes a page with one action.', 'cta', 70,
$json${"kind":"cta","heading":"Ready when you are.","body":"Tell us what you need.","primaryCta":{"label":"Contact us","href":"/contact"}}$json$::jsonb);

-- Every starter must itself be valid content, or a business would be handed a draft it cannot save.
do $check$
declare v_row record; v_content jsonb; v_problem text;
begin
  for v_row in select key, pages, navigation from public.public_site_templates loop
    v_content := app.rekey_site_content(v_row.pages, v_row.navigation);
    v_problem := app.public_site_content_problem(v_content -> 'pages', v_content -> 'navigation');
    if v_problem is not null then raise exception 'site template % is invalid: %', v_row.key, v_problem; end if;
  end loop;
  for v_row in select key, page from public.public_page_templates loop
    v_content := app.rekey_site_content(
      jsonb_build_array(
        jsonb_build_object('name','Home','slug','','isHome',true,'seoTitle','Home','seoDescription','Home','sections','[]'::jsonb),
        v_row.page), '[]'::jsonb);
    v_problem := app.public_site_content_problem(v_content -> 'pages', v_content -> 'navigation');
    if v_problem is not null then raise exception 'page template % is invalid: %', v_row.key, v_problem; end if;
  end loop;
  for v_row in select key, kind, section from public.public_section_patterns loop
    if v_row.section ->> 'kind' <> v_row.kind then raise exception 'section pattern % names the wrong kind', v_row.key; end if;
    v_problem := app.public_section_problem(v_row.section || jsonb_build_object('id', gen_random_uuid()));
    if v_problem is not null then raise exception 'section pattern % is invalid: %', v_row.key, v_problem; end if;
  end loop;
end
$check$;

-- ---------------------------------------------------------------------------
-- Tenant doors
-- ---------------------------------------------------------------------------

create function app.public_site_revision_json(r public.public_site_revisions)
returns jsonb language sql immutable set search_path = '' as $fn$
  select jsonb_build_object('id', r.id, 'number', r.revision_number, 'status', r.status,
    'pages', r.pages, 'navigation', r.navigation, 'createdAt', r.created_at,
    'submittedAt', r.submitted_at, 'publishedAt', r.published_at);
$fn$;
revoke all on function app.public_site_revision_json(public.public_site_revisions) from public, anon, authenticated;

-- Null when this organization has no website yet: the caller then offers to create one.
create function public.public_site_editor_state(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
    'siteId', s.id,
    'published', (select app.public_site_revision_json(r) from public.public_site_revisions r
                   where r.organization_id = s.organization_id and r.site_id = s.id and r.id = s.current_published_revision_id),
    'working', (select app.public_site_revision_json(r) from public.public_site_revisions r
                 where r.organization_id = s.organization_id and r.site_id = s.id and r.status in ('draft', 'in_review')),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'number', h.revision_number, 'status', h.status, 'createdAt', h.created_at,
        'publishedAt', h.published_at, 'archivedAt', h.archived_at) order by h.revision_number desc)
      from public.public_site_revisions h where h.organization_id = s.organization_id and h.site_id = s.id), '[]'::jsonb)
  ) into v_result
  from public.public_sites s where s.organization_id = p_organization_id;
  return v_result;
end;
$fn$;

-- Creating the website is the business's own act, from nothing or from a starter. It makes a site
-- with one draft and nothing published: no hostname is needed to create, edit or preview.
create function public.create_public_site(p_organization_id uuid, p_template_key text default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid; v_site uuid; v_revision uuid; v_name text; v_description text;
  v_pages jsonb; v_navigation jsonb; v_content jsonb;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  if exists (select 1 from public.public_sites where organization_id = p_organization_id) then
    raise exception 'this organization already has a website' using errcode = 'GD001';
  end if;

  select left(coalesce(nullif(btrim(op.display_name), ''), o.name), 70),
         left(coalesce(nullif(btrim(op.tagline), ''), nullif(btrim(op.display_name), ''), o.name), 180)
    into v_name, v_description
    from public.organizations o left join public.organization_profiles op on op.organization_id = o.id
   where o.id = p_organization_id;

  if p_template_key is null then
    v_pages := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'name', 'Home', 'slug', '', 'isHome', true,
      'seoTitle', v_name, 'seoDescription', v_description, 'sections', '[]'::jsonb));
    v_navigation := '[]'::jsonb;
  else
    select t.pages, t.navigation into v_pages, v_navigation from public.public_site_templates t where t.key = p_template_key;
    if v_pages is null then raise exception 'that template does not exist' using errcode = 'GD001'; end if;
    v_content := app.rekey_site_content(v_pages, v_navigation);
    -- The business's own name heads its pages; the starter's wording stays where it is wording.
    v_pages := (select jsonb_agg(p.value || jsonb_build_object('seoTitle', left(
        case when (p.value ->> 'isHome')::boolean then v_name else (p.value ->> 'name') || ' | ' || v_name end, 70))
        order by p.ordinality) from jsonb_array_elements(v_content -> 'pages') with ordinality p);
    v_navigation := v_content -> 'navigation';
  end if;

  insert into public.public_sites (organization_id, created_by) values (p_organization_id, v_actor) returning id into v_site;
  insert into public.public_site_revisions (organization_id, site_id, revision_number, status, pages, navigation, created_source, created_by)
  values (p_organization_id, v_site, 1, 'draft', v_pages, v_navigation, 'account', v_actor) returning id into v_revision;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', v_revision, 'public_site.created',
          jsonb_build_object('template_key', p_template_key));
  return v_revision;
end;
$fn$;

-- A new working draft from the published snapshot, or from any earlier revision: restoring is
-- copying forward, so history is never rewritten and the usual review and publish still apply.
create function public.create_public_site_draft(p_organization_id uuid, p_from_revision_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_site uuid; v_source public.public_site_revisions; v_revision uuid; v_number integer;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select s.id into v_site from public.public_sites s where s.organization_id = p_organization_id;
  if v_site is null then raise exception 'no public website is configured for this organization' using errcode = 'GD001'; end if;

  select id into v_revision from public.public_site_revisions
   where organization_id = p_organization_id and site_id = v_site and status in ('draft', 'in_review');
  if v_revision is not null then return v_revision; end if;

  select r.* into v_source from public.public_site_revisions r
   where r.organization_id = p_organization_id and r.site_id = v_site
     and r.id = coalesce(p_from_revision_id, (select current_published_revision_id from public.public_sites where organization_id = p_organization_id and id = v_site));
  if v_source.id is null then raise exception 'there is no revision to start from' using errcode = 'GD001'; end if;

  select coalesce(max(revision_number), 0) + 1 into v_number from public.public_site_revisions
   where organization_id = p_organization_id and site_id = v_site;
  insert into public.public_site_revisions (organization_id, site_id, revision_number, status, pages, navigation, created_source, created_by)
  values (p_organization_id, v_site, v_number, 'draft', v_source.pages, v_source.navigation, 'account', v_actor)
  returning id into v_revision;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', v_revision, 'public_site.draft_created',
          jsonb_build_object('revision_number', v_number, 'copied_from', v_source.id));
  return v_revision;
end;
$fn$;

create function public.update_public_site_draft(p_organization_id uuid, p_revision_id uuid, p_pages jsonb, p_navigation jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  update public.public_site_revisions set pages = p_pages, navigation = p_navigation
   where organization_id = p_organization_id and id = p_revision_id and status = 'draft'
  returning id into v_found;
  if v_found is null then raise exception 'only a draft in this organization can be edited' using errcode = 'GD001'; end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', p_revision_id, 'public_site.draft_updated', '{}'::jsonb);
end;
$fn$;

create function public.submit_public_site_revision(p_organization_id uuid, p_revision_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  update public.public_site_revisions set status = 'in_review', submitted_at = now(), submitted_by = v_actor
   where organization_id = p_organization_id and id = p_revision_id and status = 'draft' returning id into v_found;
  if v_found is null then raise exception 'only a draft can be submitted for review' using errcode = 'GD001'; end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', p_revision_id, 'public_site.submitted', '{}'::jsonb);
end;
$fn$;

-- The only publish transition. One transaction archives the previous snapshot and moves the
-- site's pointer, so every page, the navigation and every section change together.
create function public.publish_public_site_revision(p_organization_id uuid, p_revision_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_site uuid; v_previous uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select site_id into v_site from public.public_site_revisions
   where organization_id = p_organization_id and id = p_revision_id and status = 'in_review' for update;
  if v_site is null then raise exception 'only a revision in review can be published' using errcode = 'GD001'; end if;
  select current_published_revision_id into v_previous from public.public_sites
   where organization_id = p_organization_id and id = v_site for update;
  if v_previous is not null then
    update public.public_site_revisions set status = 'archived', archived_at = now()
     where organization_id = p_organization_id and site_id = v_site and id = v_previous and status = 'published';
  end if;
  update public.public_site_revisions set status = 'published', published_at = now(), published_by = v_actor
   where organization_id = p_organization_id and site_id = v_site and id = p_revision_id;
  update public.public_sites set current_published_revision_id = p_revision_id
   where organization_id = p_organization_id and id = v_site;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', p_revision_id, 'public_site.published',
          jsonb_build_object('previous_revision_id', v_previous));
end;
$fn$;

create function public.public_site_preview(p_organization_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform app.require_public_site_manager(p_organization_id);
  return app.public_site_snapshot(p_organization_id, p_revision_id);
end;
$fn$;

create function public.list_site_templates()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'description', description,
    'category', category, 'pages', pages, 'navigation', navigation) order by display_order, name), '[]'::jsonb)
  from public.public_site_templates where (select auth.uid()) is not null;
$fn$;

create function public.list_page_templates()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'description', description,
    'category', category, 'page', page) order by display_order, name), '[]'::jsonb)
  from public.public_page_templates where (select auth.uid()) is not null;
$fn$;

create function public.list_section_patterns()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'description', description,
    'kind', kind, 'section', section) order by display_order, name), '[]'::jsonb)
  from public.public_section_patterns where (select auth.uid()) is not null;
$fn$;

revoke all on function public.public_site_editor_state(uuid) from public, anon;
revoke all on function public.create_public_site(uuid, text) from public, anon;
revoke all on function public.create_public_site_draft(uuid, uuid) from public, anon;
revoke all on function public.update_public_site_draft(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.submit_public_site_revision(uuid, uuid) from public, anon;
revoke all on function public.publish_public_site_revision(uuid, uuid) from public, anon;
revoke all on function public.public_site_preview(uuid, uuid) from public, anon;
revoke all on function public.list_site_templates() from public, anon;
revoke all on function public.list_page_templates() from public, anon;
revoke all on function public.list_section_patterns() from public, anon;
grant execute on function public.public_site_editor_state(uuid) to authenticated;
grant execute on function public.create_public_site(uuid, text) to authenticated;
grant execute on function public.create_public_site_draft(uuid, uuid) to authenticated;
grant execute on function public.update_public_site_draft(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.submit_public_site_revision(uuid, uuid) to authenticated;
grant execute on function public.publish_public_site_revision(uuid, uuid) to authenticated;
grant execute on function public.public_site_preview(uuid, uuid) to authenticated;
grant execute on function public.list_site_templates() to authenticated;
grant execute on function public.list_page_templates() to authenticated;
grant execute on function public.list_section_patterns() to authenticated;

comment on function public.publish_public_site_revision(uuid, uuid) is
  'The only publish transition. Serializes the site, archives the previous immutable snapshot, advances the site''s published pointer and records the accountable actor in one transaction: every page and the navigation switch together.';
comment on function public.published_hostname_site(text) is
  'A hostname''s surface and, for a website, the whole published snapshot. The caller picks the page for a path from it, so one read can never mix revisions.';
