-- A public website is tenant configuration with history, not mutable React copy.
--
-- Stable site/page identities are separated from immutable revisions.  The page points at the
-- one revision strangers may read; drafts and review candidates are never inferred from a
-- timestamp or status scan.  GOLD is selected through deployment configuration, just like the
-- workflow-review target: a migration cannot know a deployment's organization id.

create table public.public_sites (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  default_locale text not null default 'en' check (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  primary key (organization_id, id),
  unique (organization_id)
);

create table public.public_pages (
  organization_id uuid not null,
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  page_key text not null check (page_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  slug text not null check (slug = '' or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  current_published_revision_id uuid,
  created_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, site_id)
    references public.public_sites (organization_id, id) on delete cascade,
  unique (organization_id, site_id, page_key),
  unique (organization_id, site_id, slug)
);

create table public.public_page_revisions (
  organization_id uuid not null,
  page_id uuid not null,
  id uuid not null default gen_random_uuid(),
  revision_number integer not null check (revision_number > 0),
  status text not null check (status in ('draft', 'in_review', 'published', 'archived')),
  seo_title text not null check (length(btrim(seo_title)) between 1 and 70),
  seo_description text not null check (length(btrim(seo_description)) between 1 and 180),
  sections jsonb not null,
  created_source text not null check (created_source in ('migration', 'account')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  submitted_at timestamptz,
  submitted_by uuid references auth.users (id),
  published_at timestamptz,
  published_by uuid references auth.users (id),
  archived_at timestamptz,
  primary key (organization_id, page_id, id),
  foreign key (organization_id, page_id)
    references public.public_pages (organization_id, id) on delete cascade,
  unique (organization_id, page_id, revision_number),
  check ((created_source = 'migration' and created_by is null) or
         (created_source = 'account' and created_by is not null)),
  check ((status = 'draft' and submitted_at is null and published_at is null) or
         (status = 'in_review' and submitted_at is not null and published_at is null) or
         (status = 'published' and submitted_at is not null and published_at is not null) or
         (status = 'archived' and published_at is not null and archived_at is not null))
);

alter table public.public_pages
  add constraint public_pages_published_revision_belongs_to_page
  foreign key (organization_id, id, current_published_revision_id)
  references public.public_page_revisions (organization_id, page_id, id);

create unique index public_page_one_working_revision
  on public.public_page_revisions (organization_id, page_id)
  where status in ('draft', 'in_review');

create unique index public_page_one_published_revision
  on public.public_page_revisions (organization_id, page_id)
  where status = 'published';

alter table public.platform_settings
  add column gold_public_site_id uuid;

alter table public.platform_settings
  add constraint platform_settings_gold_public_site_fk
  foreign key (workflow_review_organization_id, gold_public_site_id)
  references public.public_sites (organization_id, id);

comment on column public.platform_settings.gold_public_site_id is
  'The one site rendered at the platform root. Set only by the deployment bootstrap snippet; no hostname or arbitrary tenant routing is implied.';

alter table public.public_sites enable row level security;
alter table public.public_sites force row level security;
alter table public.public_pages enable row level security;
alter table public.public_pages force row level security;
alter table public.public_page_revisions enable row level security;
alter table public.public_page_revisions force row level security;

revoke all on public.public_sites from public, anon, authenticated;
revoke all on public.public_pages from public, anon, authenticated;
revoke all on public.public_page_revisions from public, anon, authenticated;

-- The only content vocabulary this slice can store.  There is no HTML, component name, CSS,
-- script or arbitrary URL field. TypeScript repeats this schema at the trust boundary for useful
-- form errors; this trigger remains authoritative for every possible writer.
create function app.public_homepage_sections_are_valid(p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_typeof(p_sections) = 'array'
    and jsonb_array_length(p_sections) = 6
    and (select count(distinct item->>'kind') = 6 from jsonb_array_elements(p_sections) item)
    and (select bool_and(
      case item->>'kind'
        when 'hero' then
          item ?& array['eyebrow','heading','body','primaryCta','secondaryCta']
          and jsonb_typeof(item->'primaryCta') = 'object'
          and jsonb_typeof(item->'secondaryCta') = 'object'
        when 'problem' then
          item ?& array['heading','paragraphs'] and jsonb_typeof(item->'paragraphs') = 'array'
          and jsonb_array_length(item->'paragraphs') between 1 and 4
        when 'capabilities' then
          item ?& array['eyebrow','heading','body','items'] and jsonb_typeof(item->'items') = 'array'
          and jsonb_array_length(item->'items') between 1 and 9
        when 'process' then
          item ?& array['eyebrow','heading','items'] and jsonb_typeof(item->'items') = 'array'
          and jsonb_array_length(item->'items') between 1 and 6
        when 'trust' then
          item ?& array['eyebrow','heading','items'] and jsonb_typeof(item->'items') = 'array'
          and jsonb_array_length(item->'items') between 1 and 6
        when 'cta' then
          item ?& array['heading','body','primaryCta','secondaryCta']
          and jsonb_typeof(item->'primaryCta') = 'object'
          and jsonb_typeof(item->'secondaryCta') = 'object'
        else false
      end
      and length(btrim(item->>'heading')) between 1 and 240
    ) from jsonb_array_elements(p_sections) item)
    and not exists (
      select 1 from jsonb_array_elements(p_sections) item
      where item->>'kind' not in ('hero','problem','capabilities','process','trust','cta')
    );
$fn$;

create function app.guard_public_page_revision()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if not app.public_homepage_sections_are_valid(new.sections) then
    raise exception 'public homepage sections do not match the supported vocabulary'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status in ('published', 'archived') and
     (new.sections is distinct from old.sections or
      new.seo_title is distinct from old.seo_title or
      new.seo_description is distinct from old.seo_description or
      new.revision_number is distinct from old.revision_number or
      new.created_at is distinct from old.created_at or
      new.created_by is distinct from old.created_by) then
    raise exception 'a published public page revision is immutable' using errcode = '55000';
  end if;

  return new;
end;
$fn$;

create trigger public_page_revision_guard
before insert or update on public.public_page_revisions
for each row execute function app.guard_public_page_revision();

create function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select $json$[
    {"kind":"hero","eyebrow":"Configurable business operations","heading":"Your business, operating as one system.","body":"GOLD connects the work, customers, schedule, conversations and money that small operations businesses manage across disconnected tools today—then configures the system around how the business actually runs.","primaryCta":{"label":"Request a workflow review","href":"/workflow-review"},"secondaryCta":{"label":"See how GOLD works","href":"#how-it-works"}},
    {"kind":"problem","heading":"The problem is not one bad tool. It is the space between all of them.","paragraphs":["A spreadsheet knows the customer but not the appointment. A calendar knows the time but not the price. A phone holds the conversation but not the work it changed.","GOLD gives those facts one operational home, so the next action starts with the same customer, work and history instead of another round of copying."]},
    {"kind":"capabilities","eyebrow":"The platform","heading":"One foundation, configured around the operation.","body":"Start with the parts the business needs. Add more without splitting customer and work history into another system.","items":[{"title":"Run the work","body":"Keep jobs, scheduling, resources, customers and locations connected from request to completion."},{"title":"Keep the history","body":"Calls, messages, job updates, invoices and payments stay with the customer they concern."},{"title":"Configure the operation","body":"Use your own work types, stages, pricing, hours and roles without creating another application."},{"title":"Automate deliberately","body":"Let rules handle defined steps and keep consequential decisions reviewable by a person."},{"title":"Meet customers cleanly","body":"Offer booking and a customer portal in the business’s own name, words and brand."},{"title":"See what needs attention","body":"Start with today’s commitments and exceptions, then move into reports when the question needs more."}]},
    {"kind":"process","eyebrow":"Implementation","heading":"Configured with the business, not dropped at the door.","items":[{"step":"01","title":"Understand the workflow","body":"Map how work arrives, moves, gets scheduled and gets paid today."},{"step":"02","title":"Configure the business","body":"Set up the operation’s real services, stages, prices, hours and responsibilities."},{"step":"03","title":"Review and launch","body":"Test the complete path, resolve what is missing, and launch only when the business approves it."},{"step":"04","title":"Improve over time","body":"Add integrations, automation and new capabilities without replacing the foundation."}]},
    {"kind":"trust","eyebrow":"Built for trust","heading":"Control stays explicit.","items":[{"title":"One tenant boundary","body":"Organization data stays organization-scoped from the screen through the database."},{"title":"Human review where it matters","body":"AI can draft and assist; it does not silently publish content or take consequential action."},{"title":"Your operation, not a fork","body":"Configuration represents the differences between businesses while the platform stays maintainable."},{"title":"A deliberate launch","body":"Readiness is visible, reviewable and approved before the business goes live."}]},
    {"kind":"cta","heading":"Start with the workflow that is holding the business back.","body":"A workflow review maps the current operation and identifies where one connected system can remove repeated work, missed handoffs and invisible commitments.","primaryCta":{"label":"Request a workflow review","href":"/workflow-review"},"secondaryCta":{"label":"Prefer to explore independently? Create an account.","href":"/sign-up"}}
  ]$json$::jsonb;
$fn$;

create function app.bootstrap_gold_public_site(p_organization_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_site uuid;
  v_page uuid;
  v_revision uuid;
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'the GOLD organization does not exist' using errcode = '23503';
  end if;

  insert into public.public_sites (organization_id, created_by)
  values (p_organization_id, null)
  on conflict (organization_id) do update set default_locale = public.public_sites.default_locale
  returning id into v_site;

  insert into public.public_pages (organization_id, site_id, page_key, slug)
  values (p_organization_id, v_site, 'home', '')
  on conflict (organization_id, site_id, page_key) do update set page_key = excluded.page_key
  returning id, current_published_revision_id into v_page, v_revision;

  if v_revision is null then
    insert into public.public_page_revisions (
      organization_id, page_id, revision_number, status, seo_title, seo_description, sections,
      created_source, submitted_at, published_at
    ) values (
      p_organization_id, v_page, 1, 'published',
      'GOLD | One operating system for your business',
      'Connect work, customers, scheduling, communications, payments and automation in one configurable business system.',
      app.default_gold_homepage_sections(), 'migration', now(), now()
    ) returning id into v_revision;

    update public.public_pages
    set current_published_revision_id = v_revision
    where organization_id = p_organization_id and id = v_page;
  end if;

  update public.platform_settings
  set gold_public_site_id = v_site
  where singleton and workflow_review_organization_id = p_organization_id;

  return v_site;
end;
$fn$;

revoke all on function app.bootstrap_gold_public_site(uuid) from public, anon, authenticated;

-- A deployment already configured for workflow-review receives a byte-for-byte database copy of
-- the homepage in the same migration. Fresh deployments run the amended setup snippet later.
do $bootstrap$
declare v_org uuid;
begin
  select workflow_review_organization_id into v_org from public.platform_settings where singleton;
  if v_org is not null then perform app.bootstrap_gold_public_site(v_org); end if;
end
$bootstrap$;

create function public.published_gold_homepage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'siteId', s.id,
    'organizationId', s.organization_id,
    'pageId', p.id,
    'revisionId', r.id,
    'revisionNumber', r.revision_number,
    'seoTitle', r.seo_title,
    'seoDescription', r.seo_description,
    'sections', r.sections,
    'profile', jsonb_build_object(
      'displayName', coalesce(op.display_name, o.name),
      'tagline', op.tagline,
      'intro', op.intro,
      'contactEmail', op.contact_email,
      'contactPhone', op.contact_phone,
      'address', op.address
    ),
    'brand', jsonb_build_object(
      'accent', b.accent,
      'headingFont', coalesce(b.heading_font, 'sans'),
      'bodyFont', coalesce(b.body_font, 'sans'),
      'logoPath', b.logo_path
    )
  )
  from public.platform_settings ps
  join public.public_sites s on s.id = ps.gold_public_site_id
    and s.organization_id = ps.workflow_review_organization_id
  join public.public_pages p on p.organization_id = s.organization_id and p.site_id = s.id
    and p.page_key = 'home'
  join public.public_page_revisions r on r.organization_id = p.organization_id
    and r.page_id = p.id and r.id = p.current_published_revision_id and r.status = 'published'
  join public.organizations o on o.id = s.organization_id
  left join public.organization_profiles op on op.organization_id = o.id
  left join public.brand_settings b on b.organization_id = o.id
  where ps.singleton;
$fn$;

revoke all on function public.published_gold_homepage() from public;
grant execute on function public.published_gold_homepage() to anon, authenticated;

create function app.require_public_site_manager(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return v_actor;
end;
$fn$;
revoke all on function app.require_public_site_manager(uuid) from public, anon, authenticated;

create function public.public_homepage_editor_state(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
    'siteId', s.id, 'pageId', p.id,
    'published', case when published.id is null then null else jsonb_build_object(
      'id', published.id, 'number', published.revision_number, 'status', published.status,
      'seoTitle', published.seo_title, 'seoDescription', published.seo_description,
      'sections', published.sections, 'publishedAt', published.published_at) end,
    'working', case when working.id is null then null else jsonb_build_object(
      'id', working.id, 'number', working.revision_number, 'status', working.status,
      'seoTitle', working.seo_title, 'seoDescription', working.seo_description,
      'sections', working.sections, 'submittedAt', working.submitted_at) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'number', h.revision_number, 'status', h.status,
      'publishedAt', h.published_at, 'archivedAt', h.archived_at
    ) order by h.revision_number desc) from public.public_page_revisions h
      where h.organization_id = p.organization_id and h.page_id = p.id), '[]'::jsonb)
  ) into v_result
  from public.public_sites s
  join public.public_pages p on p.organization_id = s.organization_id and p.site_id = s.id and p.page_key = 'home'
  left join public.public_page_revisions published on published.organization_id = p.organization_id
    and published.page_id = p.id and published.id = p.current_published_revision_id
  left join public.public_page_revisions working on working.organization_id = p.organization_id
    and working.page_id = p.id and working.status in ('draft','in_review')
  where s.organization_id = p_organization_id;
  return v_result;
end;
$fn$;

create function public.create_public_homepage_draft(p_organization_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_site uuid; v_page uuid; v_revision uuid; v_number integer;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select s.id, p.id into v_site, v_page from public.public_sites s
  join public.public_pages p on p.organization_id=s.organization_id and p.site_id=s.id and p.page_key='home'
  where s.organization_id=p_organization_id;
  if v_page is null then
    insert into public.public_sites (organization_id, created_by) values (p_organization_id, v_actor)
      on conflict (organization_id) do update set default_locale=public.public_sites.default_locale returning id into v_site;
    insert into public.public_pages (organization_id,site_id,page_key,slug)
      values (p_organization_id,v_site,'home','') returning id into v_page;
  end if;
  select id into v_revision from public.public_page_revisions
    where organization_id=p_organization_id and page_id=v_page and status in ('draft','in_review');
  if v_revision is not null then return v_revision; end if;
  select coalesce(max(revision_number),0)+1 into v_number from public.public_page_revisions
    where organization_id=p_organization_id and page_id=v_page;
  insert into public.public_page_revisions
    (organization_id,page_id,revision_number,status,seo_title,seo_description,sections,created_source,created_by)
  select p_organization_id,v_page,v_number,'draft',
    coalesce(r.seo_title,'GOLD | One operating system for your business'),
    coalesce(r.seo_description,'Connect work, customers, scheduling, communications, payments and automation in one configurable business system.'),
    coalesce(r.sections,app.default_gold_homepage_sections()),'account',v_actor
  from (select 1) seed left join public.public_pages p on p.organization_id=p_organization_id and p.id=v_page
  left join public.public_page_revisions r on r.organization_id=p.organization_id and r.page_id=p.id and r.id=p.current_published_revision_id
  returning id into v_revision;
  insert into public.events (organization_id,actor_id,entity_type,entity_id,action,payload)
    values (p_organization_id,v_actor,'public_page_revision',v_revision,'public_page.draft_created',jsonb_build_object('revision_number',v_number));
  return v_revision;
end;
$fn$;

create function public.update_public_homepage_draft(
  p_organization_id uuid, p_revision_id uuid, p_seo_title text,
  p_seo_description text, p_sections jsonb
)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_page uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  if not app.public_homepage_sections_are_valid(p_sections) then
    raise exception 'public homepage sections do not match the supported vocabulary' using errcode='23514';
  end if;
  update public.public_page_revisions set
    seo_title=btrim(p_seo_title), seo_description=btrim(p_seo_description), sections=p_sections
  where organization_id=p_organization_id and id=p_revision_id and status='draft'
  returning page_id into v_page;
  if v_page is null then raise exception 'only a draft in this organization can be edited' using errcode='GD001'; end if;
  insert into public.events (organization_id,actor_id,entity_type,entity_id,action,payload)
    values (p_organization_id,v_actor,'public_page_revision',p_revision_id,'public_page.draft_updated','{}'::jsonb);
end;
$fn$;

create function public.submit_public_homepage_revision(p_organization_id uuid,p_revision_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_page uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  update public.public_page_revisions set status='in_review',submitted_at=now(),submitted_by=v_actor
  where organization_id=p_organization_id and id=p_revision_id and status='draft' returning page_id into v_page;
  if v_page is null then raise exception 'only a draft can be submitted for review' using errcode='GD001'; end if;
  insert into public.events (organization_id,actor_id,entity_type,entity_id,action,payload)
    values (p_organization_id,v_actor,'public_page_revision',p_revision_id,'public_page.submitted','{}'::jsonb);
end;
$fn$;

create function public.publish_public_homepage_revision(p_organization_id uuid,p_revision_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_page uuid; v_previous uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select page_id into v_page from public.public_page_revisions
    where organization_id=p_organization_id and id=p_revision_id and status='in_review' for update;
  if v_page is null then raise exception 'only a revision in review can be published' using errcode='GD001'; end if;
  select current_published_revision_id into v_previous from public.public_pages
    where organization_id=p_organization_id and id=v_page for update;
  if v_previous is not null then
    update public.public_page_revisions set status='archived',archived_at=now()
      where organization_id=p_organization_id and page_id=v_page and id=v_previous and status='published';
  end if;
  update public.public_page_revisions set status='published',published_at=now(),published_by=v_actor
    where organization_id=p_organization_id and page_id=v_page and id=p_revision_id;
  update public.public_pages set current_published_revision_id=p_revision_id
    where organization_id=p_organization_id and id=v_page;
  insert into public.events (organization_id,actor_id,entity_type,entity_id,action,payload)
    values (p_organization_id,v_actor,'public_page_revision',p_revision_id,'public_page.published',jsonb_build_object('previous_revision_id',v_previous));
end;
$fn$;

create function public.public_homepage_preview(p_organization_id uuid,p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
    'siteId',s.id,'organizationId',s.organization_id,'pageId',p.id,'revisionId',r.id,
    'revisionNumber',r.revision_number,'status',r.status,'seoTitle',r.seo_title,
    'seoDescription',r.seo_description,'sections',r.sections,
    'profile',jsonb_build_object('displayName',coalesce(op.display_name,o.name),'tagline',op.tagline,'intro',op.intro,'contactEmail',op.contact_email,'contactPhone',op.contact_phone,'address',op.address),
    'brand',jsonb_build_object('accent',b.accent,'headingFont',coalesce(b.heading_font,'sans'),'bodyFont',coalesce(b.body_font,'sans'),'logoPath',b.logo_path)
  ) into v_result from public.public_page_revisions r
  join public.public_pages p on p.organization_id=r.organization_id and p.id=r.page_id
  join public.public_sites s on s.organization_id=p.organization_id and s.id=p.site_id
  join public.organizations o on o.id=s.organization_id
  left join public.organization_profiles op on op.organization_id=o.id
  left join public.brand_settings b on b.organization_id=o.id
  where r.organization_id=p_organization_id and r.id=p_revision_id;
  return v_result;
end;
$fn$;

revoke all on function public.public_homepage_editor_state(uuid) from public;
revoke all on function public.create_public_homepage_draft(uuid) from public;
revoke all on function public.update_public_homepage_draft(uuid,uuid,text,text,jsonb) from public;
revoke all on function public.submit_public_homepage_revision(uuid,uuid) from public;
revoke all on function public.publish_public_homepage_revision(uuid,uuid) from public;
revoke all on function public.public_homepage_preview(uuid,uuid) from public;
grant execute on function public.public_homepage_editor_state(uuid) to authenticated;
grant execute on function public.create_public_homepage_draft(uuid) to authenticated;
grant execute on function public.update_public_homepage_draft(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.submit_public_homepage_revision(uuid,uuid) to authenticated;
grant execute on function public.publish_public_homepage_revision(uuid,uuid) to authenticated;
grant execute on function public.public_homepage_preview(uuid,uuid) to authenticated;

comment on function public.published_gold_homepage() is
  'The entire anonymous website read boundary: one configured GOLD homepage projection and its canonical public profile/brand. It cannot name a tenant and cannot expose drafts.';
comment on function public.publish_public_homepage_revision(uuid,uuid) is
  'The only publish transition. Serializes the page, archives the previous immutable revision, advances the stable pointer, and records the accountable actor in one transaction.';
