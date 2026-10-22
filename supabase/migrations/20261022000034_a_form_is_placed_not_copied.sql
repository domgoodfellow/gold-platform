-- A form is one artifact; where it appears is somebody else's reference to it.
--
-- `20261113000001` made a form a stable identity with immutable revisions and a submission that
-- names the revision it answered. This makes that artifact usable from more than its own page,
-- without copying it anywhere:
--
--   * The **website** may carry one optional `form` section that names a form by id. The website
--     revision stores the id and some words around it; the fields are read from the form's
--     published revision when the page is served, so a form edited tomorrow is published through
--     the form, not by re-publishing the website.
--   * The **portal** exposes the forms a business has chosen (`portal_forms`), to a customer who
--     arrived by a link. The customer a submission is about is the one the link was made for —
--     derived from the caller's own binding, never a value the form carried.
--   * **Booking** is not touched. Its scheduling-critical inputs stay Booking's; a later optional
--     intake form is a reference from Booking configuration (docs/constraints.md D77).
--   * An **embed** or a tenant **hostname** reaches the same published revision through the same
--     read; neither adds a table.
--
-- Placement is not a table of its own. A website's reference belongs to the website revision, the
-- portal's to `portal_forms`, and "where is this form used?" is answered by asking each owner.

-- ---------------------------------------------------------------------------
-- A public key: a link that survives a rename
-- ---------------------------------------------------------------------------

-- The business slug and the form slug are readable and can change (a business may rename itself).
-- A link already pasted into an email or a website must not die for that, so each form also has a
-- key nobody edits. 48 random bits of a v4 uuid: not guessable in practice, and it names a
-- published form anybody could already open, never anything private.
alter table public.forms add column public_key text;
update public.forms set public_key = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) where public_key is null;
alter table public.forms
  alter column public_key set not null,
  alter column public_key set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  add constraint forms_public_key_shape check (public_key ~ '^[a-f0-9]{12}$');

-- **An exception to I2, the same one the portal token and a hostname are.** A visitor arrives with
-- a key and no tenant in hand, so it must be unique across every business or the key could not
-- say which form it means. `schema-conformance.test.ts` names this index individually.
create unique index forms_public_key_unique on public.forms (public_key);

-- ---------------------------------------------------------------------------
-- Where a submission came from, and who it was about
-- ---------------------------------------------------------------------------

alter table public.form_submissions drop constraint form_submissions_source_check;
alter table public.form_submissions add constraint form_submissions_source_check
  check (source in ('hosted', 'website', 'portal', 'booking', 'embed'));

-- Context the *server* knows, never a field the visitor filled in. A portal submission carries the
-- customer the link belongs to; a person with authority may link any other response to a customer
-- afterwards. Removing a customer leaves the response.
alter table public.form_submissions add column customer_id uuid;
alter table public.form_submissions add constraint form_submissions_customer_fk
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
  on delete set null (customer_id);
alter table public.form_submissions add constraint form_submissions_portal_names_a_customer
  check (source <> 'portal' or customer_id is not null);

-- ---------------------------------------------------------------------------
-- The portal's own list
-- ---------------------------------------------------------------------------

create table public.portal_forms (
  organization_id uuid not null,
  form_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  primary key (organization_id, form_id),
  foreign key (organization_id, form_id) references public.forms (organization_id, id) on delete cascade
);
alter table public.portal_forms enable row level security;
alter table public.portal_forms force row level security;
revoke all on public.portal_forms from public, anon, authenticated;
comment on table public.portal_forms is
  'Which of a business''s forms its customers are offered in the portal. The portal owns this reference; the form does not know it is here.';

-- ---------------------------------------------------------------------------
-- What a website may say about a form
-- ---------------------------------------------------------------------------

-- The six-section vocabulary is unchanged and still positional. One optional seventh section, a
-- `form`, sits immediately before the closing call to action; nothing else may be added, removed
-- or moved. The section carries a form's id and the words around it — never its fields.
alter function app.public_homepage_sections_are_valid(jsonb) rename to public_homepage_core_sections_are_valid;

create function app.public_form_section_is_valid(p_item jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select app.jsonb_has_only_keys(p_item, array['kind', 'heading', 'body', 'formId'])
    and p_item->>'kind' = 'form'
    and jsonb_typeof(p_item->'heading') = 'string' and length(btrim(p_item->>'heading')) between 1 and 240
    and jsonb_typeof(p_item->'body') = 'string' and length(p_item->>'body') <= 600
    and jsonb_typeof(p_item->'formId') = 'string'
    and (p_item->>'formId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$fn$;

create function app.public_homepage_sections_are_valid(p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when jsonb_typeof(p_sections) = 'array' and jsonb_array_length(p_sections) = 7
      then app.public_form_section_is_valid(p_sections->5) and app.public_homepage_core_sections_are_valid(p_sections - 5)
    else app.public_homepage_core_sections_are_valid(p_sections)
  end;
$fn$;

revoke all on function app.public_form_section_is_valid(jsonb) from public, anon, authenticated;
revoke all on function app.public_homepage_sections_are_valid(jsonb) from public, anon, authenticated;
revoke all on function app.public_homepage_core_sections_are_valid(jsonb) from public, anon, authenticated;

-- A section can only name a form this business owns and has not archived. (It may still name one
-- that is not published yet: the page then simply shows nothing in that place.)
create or replace function app.guard_public_page_revision()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if not app.public_homepage_sections_are_valid(new.sections) then
    raise exception 'public homepage sections do not match the supported vocabulary'
      using errcode = '23514';
  end if;

  if jsonb_array_length(new.sections) = 7 and (tg_op = 'INSERT' or new.sections is distinct from old.sections) then
    if not exists (
      select 1 from public.forms f
       where f.organization_id = new.organization_id
         and f.id = (new.sections->5->>'formId')::uuid
         and f.archived_at is null
    ) then
      raise exception 'the website names a form that does not exist in this organization'
        using errcode = '23503';
    end if;
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

-- ---------------------------------------------------------------------------
-- One projection of a published form, read the same way by every surface
-- ---------------------------------------------------------------------------

-- A published, unarchived form's published revision, or null. A draft and an archived form are the
-- same absence.
create function app.form_projection(p_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'formId', f.id, 'publicKey', f.public_key, 'revisionId', r.id, 'revisionNumber', r.revision_number,
    'name', f.name, 'definition', r.definition)
  from public.forms f
  join public.form_revisions r on r.organization_id = f.organization_id and r.form_id = f.id
    and r.id = f.current_published_revision_id and r.status = 'published'
  where f.id = p_form_id and f.archived_at is null;
$fn$;

-- The form plus the business's own public identity, for a page that is only the form.
create function app.form_page_projection(p_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.form_projection(f.id) || jsonb_build_object(
    'profile', jsonb_build_object(
      'displayName', coalesce(op.display_name, o.name),
      'tagline', op.tagline, 'intro', op.intro,
      'contactEmail', op.contact_email, 'contactPhone', op.contact_phone, 'address', op.address),
    'brand', jsonb_build_object(
      'accent', b.accent,
      'headingFont', coalesce(b.heading_font, 'sans'),
      'bodyFont', coalesce(b.body_font, 'sans'),
      'logoPath', b.logo_path))
  from public.forms f
  join public.organizations o on o.id = f.organization_id
  left join public.organization_profiles op on op.organization_id = o.id
  left join public.brand_settings b on b.organization_id = o.id
  where f.id = p_form_id and app.form_projection(f.id) is not null;
$fn$;

-- The published forms a website's sections name, keyed by form id, read from the form and never
-- from the website. An unpublished, archived or foreign form is simply not in the map.
create function app.website_form_projections(p_organization_id uuid, p_sections jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_object_agg(p.f_id, p.projection), '{}'::jsonb)
  from (
    select f.id::text as f_id, app.form_projection(f.id) as projection
    from public.forms f
    where f.organization_id = p_organization_id
      and f.id in (select (s->>'formId')::uuid from jsonb_array_elements(p_sections) s where s->>'kind' = 'form')
  ) p
  where p.projection is not null;
$fn$;

revoke all on function app.form_projection(uuid) from public, anon, authenticated;
revoke all on function app.form_page_projection(uuid) from public, anon, authenticated;
revoke all on function app.website_form_projections(uuid, jsonb) from public, anon, authenticated;

create or replace function public.published_form(p_organization_slug text, p_form_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.form_page_projection(f.id)
  from public.organizations o
  join public.forms f on f.organization_id = o.id and f.slug = lower(btrim(p_form_slug))
  where o.slug = lower(btrim(p_organization_slug));
$fn$;

create function public.published_form_by_key(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.form_page_projection(f.id) from public.forms f where f.public_key = lower(btrim(p_key));
$fn$;

-- A form served at a business's own hostname. The organization is whatever the hostname resolver
-- says it is — the same resolver a home page uses — and only a website hostname serves one.
create function public.published_hostname_form(p_hostname text, p_form_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.form_page_projection(f.id)
  from app.resolve_hostname(p_hostname) r
  join public.forms f on f.organization_id = r.organization_id and f.slug = lower(btrim(p_form_slug))
  where r.surface = 'website'
  limit 1;
$fn$;

revoke all on function public.published_form_by_key(text) from public;
revoke all on function public.published_hostname_form(text, text) from public;
grant execute on function public.published_form_by_key(text) to anon, authenticated;
grant execute on function public.published_hostname_form(text, text) to anon, authenticated;

-- The three website projections gain a `forms` map beside `sections`. Nothing else in them moves.
create or replace function public.published_gold_homepage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'siteId',s.id,'organizationId',s.organization_id,'pageId',p.id,'revisionId',r.id,
    'revisionNumber',r.revision_number,'seoTitle',r.seo_title,'seoDescription',r.seo_description,'sections',r.sections,
    'forms',app.website_form_projections(s.organization_id,r.sections),
    'profile',jsonb_build_object('displayName',coalesce(op.display_name,o.name),'tagline',op.tagline,'intro',op.intro,'contactEmail',op.contact_email,'contactPhone',op.contact_phone,'address',op.address),
    'brand',jsonb_build_object('accent',b.accent,'headingFont',coalesce(b.heading_font,'sans'),'bodyFont',coalesce(b.body_font,'sans'),'logoPath',b.logo_path)
  ) from public.platform_settings ps
  join public.public_sites s on s.organization_id=ps.gold_public_organization_id and s.id=ps.gold_public_site_id
  join public.public_pages p on p.organization_id=s.organization_id and p.site_id=s.id and p.page_key='home'
  join public.public_page_revisions r on r.organization_id=p.organization_id and r.page_id=p.id and r.id=p.current_published_revision_id and r.status='published'
  join public.organizations o on o.id=s.organization_id
  left join public.organization_profiles op on op.organization_id=o.id
  left join public.brand_settings b on b.organization_id=o.id
  where ps.singleton;
$fn$;

create or replace function public.public_homepage_preview(p_organization_id uuid, p_revision_id uuid)
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
    'siteId',s.id,'organizationId',s.organization_id,'pageId',p.id,'revisionId',r.id,
    'revisionNumber',r.revision_number,'status',r.status,'seoTitle',r.seo_title,
    'seoDescription',r.seo_description,'sections',r.sections,
    'forms',app.website_form_projections(s.organization_id,r.sections),
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

create or replace function public.published_hostname_site(p_hostname text)
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
        'forms', app.website_form_projections(s.organization_id, rv.sections),
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

-- ---------------------------------------------------------------------------
-- One way a submission is written
-- ---------------------------------------------------------------------------

-- Every door a submission can arrive through ends here, so there is one place that decides whether
-- it is accepted. The abuse policy is that place's own first step: a form takes at most
-- `app.form_submissions_per_minute()` responses a minute, in total, whoever sends them. It is a
-- flood guard for the business's inbox, not an identity check — an anonymous visitor has no
-- identity to limit — and a per-sender or provider-backed policy replaces this function's body
-- without any door changing.
create function app.form_submissions_per_minute()
returns integer
language sql
immutable
set search_path = ''
as $fn$ select 30; $fn$;

create function app.record_form_submission(
  p_organization_id uuid, p_form_id uuid, p_revision_id uuid, p_answers jsonb,
  p_source text, p_actor uuid, p_customer_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_current uuid;
  v_archived timestamptz;
  v_definition jsonb;
  v_number integer;
  v_problem text;
  v_submission uuid;
begin
  select current_published_revision_id, archived_at into v_current, v_archived
    from public.forms where organization_id = p_organization_id and id = p_form_id;
  if v_current is null or v_archived is not null then
    raise exception 'this form is not accepting responses' using errcode = 'GD001';
  end if;
  -- The visitor loaded an earlier version. Their answers belong to a form that no longer exists as
  -- shown; they are told to reload rather than having them quietly judged against another one.
  if v_current is distinct from p_revision_id then
    raise exception 'this form has changed since it was opened' using errcode = 'GD002';
  end if;

  if (select count(*) from public.form_submissions
       where organization_id = p_organization_id and form_id = p_form_id
         and submitted_at > now() - interval '1 minute') >= app.form_submissions_per_minute() then
    raise exception 'this form is receiving too many responses right now; try again shortly' using errcode = 'GD003';
  end if;

  select definition, revision_number into v_definition, v_number from public.form_revisions
   where organization_id = p_organization_id and form_id = p_form_id and id = v_current and status = 'published';

  v_problem := app.form_answers_problem(v_definition, p_answers);
  if v_problem is not null then raise exception '%', v_problem using errcode = '23514'; end if;

  insert into public.form_submissions (organization_id, form_id, form_revision_id, submitted_by, answers, source, customer_id)
  values (p_organization_id, p_form_id, v_current, p_actor, p_answers, p_source, p_customer_id)
  returning id into v_submission;

  -- The fact, not what anyone does about it: the answers stay in the submission (they are personal),
  -- and whatever consumes the event reads them from there.
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, p_actor, 'form_submission', v_submission, 'form.submitted',
          jsonb_build_object('form_id', p_form_id, 'revision_id', v_current, 'revision_number', v_number, 'source', p_source));

  return v_submission;
end;
$fn$;
revoke all on function app.form_submissions_per_minute() from public, anon, authenticated;
revoke all on function app.record_form_submission(uuid, uuid, uuid, jsonb, text, uuid, uuid) from public, anon, authenticated;

-- The slug-addressed door is retired: the hosted page resolves its slugs to the form's key and uses
-- the one door below, so there is a single way for an anonymous caller to write a response.
drop function public.submit_public_form(text, text, uuid, jsonb);

-- The one anonymous door: the form is named by its public key and the
-- organization is whatever owns it. The caller may say which of these three public surfaces it is;
-- `portal` and `booking` are not available here, because those are only true when the portal's or
-- booking's own authority says so.
create function public.submit_public_form_by_key(
  p_public_key text, p_revision_id uuid, p_answers jsonb, p_source text default 'hosted'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_form uuid;
begin
  if v_actor is null then
    raise exception 'submit_public_form_by_key requires an authenticated caller' using errcode = '42501';
  end if;
  if p_source not in ('hosted', 'website', 'embed') then
    raise exception 'that is not a public source' using errcode = '22023';
  end if;
  select organization_id, id into v_org, v_form from public.forms where public_key = lower(btrim(p_public_key));
  if v_form is null then
    raise exception 'this form is not accepting responses' using errcode = 'GD001';
  end if;
  return app.record_form_submission(v_org, v_form, p_revision_id, p_answers, p_source, v_actor, null);
end;
$fn$;

revoke all on function public.submit_public_form_by_key(text, uuid, jsonb, text) from public;
grant execute on function public.submit_public_form_by_key(text, uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The portal
-- ---------------------------------------------------------------------------

create function public.set_portal_form(p_organization_id uuid, p_form_id uuid, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_archived timestamptz; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select id, archived_at into v_found, v_archived from public.forms
   where organization_id = p_organization_id and id = p_form_id;
  if v_found is null then raise exception 'that form does not exist in this organization' using errcode = 'GD001'; end if;
  if p_enabled then
    if v_archived is not null then raise exception 'an archived form cannot be offered in the portal' using errcode = 'GD001'; end if;
    insert into public.portal_forms (organization_id, form_id, created_by)
    values (p_organization_id, p_form_id, v_actor) on conflict do nothing;
  else
    delete from public.portal_forms where organization_id = p_organization_id and form_id = p_form_id;
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', p_form_id,
          case when p_enabled then 'form.portal_enabled' else 'form.portal_disabled' end, '{}'::jsonb);
end;
$fn$;

-- What a recognised customer is offered. The business comes from the caller's own binding.
create function public.portal_forms_available()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(app.form_projection(pf.form_id) order by f.name), '[]'::jsonb)
  from public.portal_forms pf
  join public.forms f on f.organization_id = pf.organization_id and f.id = pf.form_id
  where pf.organization_id = app.current_external_tenant()
    and app.current_external_customer() is not null
    and app.form_projection(pf.form_id) is not null;
$fn$;

-- The customer this response is about is the one the caller's portal link was made for. Nothing the
-- form carried can name another.
create function public.submit_portal_form(p_form_id uuid, p_revision_id uuid, p_answers jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid := app.current_external_tenant();
  v_customer uuid := app.current_external_customer();
begin
  if v_actor is null or v_org is null or v_customer is null then
    raise exception 'submit_portal_form requires a recognised portal customer' using errcode = '42501';
  end if;
  if not exists (select 1 from public.portal_forms where organization_id = v_org and form_id = p_form_id) then
    raise exception 'this form is not available in the portal' using errcode = 'GD001';
  end if;
  return app.record_form_submission(v_org, p_form_id, p_revision_id, p_answers, 'portal', v_actor, v_customer);
end;
$fn$;

revoke all on function public.set_portal_form(uuid, uuid, boolean) from public;
revoke all on function public.portal_forms_available() from public;
revoke all on function public.submit_portal_form(uuid, uuid, jsonb) from public;
grant execute on function public.set_portal_form(uuid, uuid, boolean) to authenticated;
grant execute on function public.portal_forms_available() to authenticated;
grant execute on function public.submit_portal_form(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Where a form is used, and what that means for archiving it
-- ---------------------------------------------------------------------------

-- Each owner answers for its own reference: the website's live page, its working draft, and the
-- portal's list. Booking has no form reference yet and says so.
create function app.form_placements(p_organization_id uuid, p_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'websitePublished', exists (
      select 1 from public.public_page_revisions r
       where r.organization_id = p_organization_id and r.status = 'published'
         and r.sections @> jsonb_build_array(jsonb_build_object('kind', 'form', 'formId', p_form_id::text))),
    'websiteDraft', exists (
      select 1 from public.public_page_revisions r
       where r.organization_id = p_organization_id and r.status in ('draft', 'in_review')
         and r.sections @> jsonb_build_array(jsonb_build_object('kind', 'form', 'formId', p_form_id::text))),
    'portal', exists (select 1 from public.portal_forms pf where pf.organization_id = p_organization_id and pf.form_id = p_form_id),
    'booking', false);
$fn$;
revoke all on function app.form_placements(uuid, uuid) from public, anon, authenticated;

-- Archiving is how a form leaves; it must not leave a page with a hole in it. A form something
-- live still points at has to be taken out of that place first.
create or replace function public.set_form_archived(p_organization_id uuid, p_form_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_found uuid; v_placements jsonb; v_where text;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select id into v_found from public.forms where organization_id = p_organization_id and id = p_form_id for update;
  if v_found is null then raise exception 'that form does not exist in this organization' using errcode = 'GD001'; end if;
  if p_archived then
    v_placements := app.form_placements(p_organization_id, p_form_id);
    v_where := concat_ws(' and ',
      case when (v_placements->>'websitePublished')::boolean then 'the website' end,
      case when (v_placements->>'portal')::boolean then 'the portal' end);
    if v_where <> '' then
      raise exception 'this form is still used by %; remove it there first', v_where using errcode = 'GD001';
    end if;
  end if;
  update public.forms set
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then v_actor else null end,
    updated_at = now()
   where organization_id = p_organization_id and id = p_form_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', p_form_id,
          case when p_archived then 'form.archived' else 'form.restored' end, '{}'::jsonb);
end;
$fn$;

-- The list and the editor now say how a form is reached and where it is used.
create or replace function public.list_forms(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_public_site_manager(p_organization_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'slug', f.slug, 'publicKey', f.public_key,
      'archived', f.archived_at is not null,
      'publishedRevisionNumber', pub.revision_number,
      'publishedAt', pub.published_at,
      'hasDraft', exists (select 1 from public.form_revisions d
                           where d.organization_id = f.organization_id and d.form_id = f.id and d.status = 'draft'),
      'submissionCount', (select count(*) from public.form_submissions s
                           where s.organization_id = f.organization_id and s.form_id = f.id),
      'lastSubmittedAt', (select max(s.submitted_at) from public.form_submissions s
                           where s.organization_id = f.organization_id and s.form_id = f.id),
      'updatedAt', f.updated_at,
      'placements', app.form_placements(f.organization_id, f.id)
    ) order by f.archived_at is not null, f.updated_at desc)
    from public.forms f
    left join public.form_revisions pub on pub.organization_id = f.organization_id
      and pub.form_id = f.id and pub.id = f.current_published_revision_id
    where f.organization_id = p_organization_id
  ), '[]'::jsonb);
end;
$fn$;

create or replace function public.form_editor_state(p_organization_id uuid, p_form_id uuid)
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
    'form', jsonb_build_object('id', f.id, 'name', f.name, 'slug', f.slug, 'publicKey', f.public_key,
                               'archived', f.archived_at is not null,
                               'createdFromTemplateKey', f.created_from_template_key),
    'placements', app.form_placements(f.organization_id, f.id),
    'published', case when pub.id is null then null else jsonb_build_object(
      'id', pub.id, 'number', pub.revision_number, 'status', pub.status,
      'definition', pub.definition, 'publishedAt', pub.published_at) end,
    'working', case when w.id is null then null else jsonb_build_object(
      'id', w.id, 'number', w.revision_number, 'status', w.status,
      'definition', w.definition, 'publishedAt', null) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'number', h.revision_number, 'status', h.status,
      'publishedAt', h.published_at, 'archivedAt', h.archived_at,
      'submissionCount', (select count(*) from public.form_submissions s
                           where s.organization_id = h.organization_id and s.form_revision_id = h.id)
    ) order by h.revision_number desc) from public.form_revisions h
      where h.organization_id = f.organization_id and h.form_id = f.id), '[]'::jsonb)
  ) into v_result
  from public.forms f
  left join public.form_revisions pub on pub.organization_id = f.organization_id
    and pub.form_id = f.id and pub.id = f.current_published_revision_id
  left join public.form_revisions w on w.organization_id = f.organization_id
    and w.form_id = f.id and w.status = 'draft'
  where f.organization_id = p_organization_id and f.id = p_form_id;
  return v_result;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Responses: where it came from and who it is about
-- ---------------------------------------------------------------------------

create or replace function public.list_form_submissions(p_organization_id uuid, p_form_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not exists (select 1 from public.forms where organization_id = p_organization_id and id = p_form_id) then
    return null;
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.form_submissions
               where organization_id = p_organization_id and form_id = p_form_id),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'submittedAt', s.submitted_at, 'revisionId', s.form_revision_id,
        'source', s.source, 'answers', s.answers,
        'customerId', s.customer_id, 'customerName', c.name) order by s.submitted_at desc)
      from (select * from public.form_submissions
             where organization_id = p_organization_id and form_id = p_form_id
             order by submitted_at desc limit v_limit) s
      left join public.customers c on c.organization_id = s.organization_id and c.id = s.customer_id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.revision_number, 'definition', r.definition))
      from public.form_revisions r
      where r.organization_id = p_organization_id and r.form_id = p_form_id
        and r.id in (select form_revision_id from public.form_submissions
                      where organization_id = p_organization_id and form_id = p_form_id)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$fn$;

-- Customers of this business that already hold the contact point a response gave — by the one rule
-- CRM uses (`app.contact_matches`), never a second matching algorithm. A response is not a
-- customer: this only offers who it might be.
create function public.form_submission_customer_candidates(p_organization_id uuid, p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_answers jsonb; v_definition jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select s.answers, r.definition into v_answers, v_definition
    from public.form_submissions s
    join public.form_revisions r on r.organization_id = s.organization_id and r.form_id = s.form_id and r.id = s.form_revision_id
   where s.organization_id = p_organization_id and s.id = p_submission_id;
  if v_answers is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone) order by c.name)
    from public.customers c
    where c.organization_id = p_organization_id
      and c.id in (
        select app.contact_matches(p_organization_id, fld->>'type', v_answers->>(fld->>'id'))
          from jsonb_array_elements(v_definition->'fields') fld
         where fld->>'type' in ('email', 'phone') and v_answers ? (fld->>'id'))
  ), '[]'::jsonb);
end;
$fn$;

-- A person with authority says which customer a response is about. A portal response already knows
-- (its customer came from the link) and is not rewritten.
create function public.link_form_submission_customer(p_organization_id uuid, p_submission_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_source text;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select source into v_source from public.form_submissions where organization_id = p_organization_id and id = p_submission_id for update;
  if v_source is null then raise exception 'that response does not exist in this organization' using errcode = 'GD001'; end if;
  if v_source = 'portal' then raise exception 'a portal response already belongs to the customer who sent it' using errcode = 'GD001'; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where organization_id = p_organization_id and id = p_customer_id) then
    raise exception 'that customer does not exist in this organization' using errcode = 'GD001';
  end if;
  update public.form_submissions set customer_id = p_customer_id
   where organization_id = p_organization_id and id = p_submission_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form_submission', p_submission_id,
          case when p_customer_id is null then 'form_submission.customer_unlinked' else 'form_submission.customer_linked' end,
          jsonb_build_object('customer_id', p_customer_id));
end;
$fn$;

revoke all on function public.form_submission_customer_candidates(uuid, uuid) from public;
revoke all on function public.link_form_submission_customer(uuid, uuid, uuid) from public;
grant execute on function public.form_submission_customer_candidates(uuid, uuid) to authenticated;
grant execute on function public.link_form_submission_customer(uuid, uuid, uuid) to authenticated;

comment on function public.submit_portal_form(uuid, uuid, jsonb) is
  'A recognised portal customer''s submission. The business and the customer come from the caller''s own binding; the form must be one the business has offered in the portal.';
comment on function public.submit_public_form_by_key(text, uuid, jsonb, text) is
  'A visitor''s submission from a website, a hostname page or an embed: the form is named by its public key, the business is whatever owns it, and the source is limited to the three public ones.';
