-- A website draft knows what it was started from, can be discarded, and cannot silently replace
-- newer published content.
--
-- Observed: GildOps' own site held a Studio draft (revision 4) opened on 30 September from the
-- homepage published then. Three later migrations each published a newer homepage (5, 6, 7)
-- around it. Nothing recorded what the draft was based on, nothing could discard it, restoring
-- was refused while it existed, and publishing it would have replaced revision 7 with older
-- content without any warning.
--
--   1. Every new draft records the published revision it was started from (`base_revision_id`)
--      and the revision whose content it copied (`copied_from_revision_id`; a restore copies an
--      older one). A draft is stale when the published pointer has moved since. Drafts from
--      before this migration recorded no base; they are stale when anything was published after
--      they were opened. Existing rows are not rewritten.
--   2. `discard_public_site_draft` ends a working draft or a revision in review. The row stays,
--      read-only, with who discarded it and when ('discarded'), and an event records it. The
--      published revision and history are untouched.
--   3. Publishing a stale revision is refused unless the caller explicitly confirms replacing the
--      newer published revision (`p_replace_newer`); the event records that it did.
--   4. Restoring with a draft open is refused instead of silently returning the open draft.
--   5. The editor reads each revision's base, copy source, staleness and last save, and which
--      experience renders the site: GildOps' marketing site or a business's own website.
--
-- Nothing here publishes, discards or edits existing content.

-- ---------------------------------------------------------------------------
-- 1. Columns and lifecycle
-- ---------------------------------------------------------------------------

alter table public.public_site_revisions
  add column base_revision_id uuid,
  add column copied_from_revision_id uuid,
  add column updated_at timestamptz,
  add column discarded_at timestamptz,
  add column discarded_by uuid references auth.users (id);

alter table public.public_site_revisions
  add constraint public_site_revisions_base_in_site
    foreign key (organization_id, site_id, base_revision_id)
    references public.public_site_revisions (organization_id, site_id, id),
  add constraint public_site_revisions_copied_from_in_site
    foreign key (organization_id, site_id, copied_from_revision_id)
    references public.public_site_revisions (organization_id, site_id, id);

comment on column public.public_site_revisions.base_revision_id is
  'The published revision when this draft was started; null when nothing was published then, and on drafts from before 20261124000001. A draft is stale once the site''s published pointer has moved from it.';
comment on column public.public_site_revisions.copied_from_revision_id is
  'The revision whose pages and navigation this draft copied: the published one, or an older one being restored.';

-- The status and lifecycle checks were created unnamed; replace them by what they say.
do $constraints$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.public_site_revisions'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) like '%archived_at IS NOT NULL%'
            or (pg_get_constraintdef(oid) like '%in_review%' and pg_get_constraintdef(oid) not like '%submitted_at%'))
  loop
    execute format('alter table public.public_site_revisions drop constraint %I', v_name);
  end loop;
end
$constraints$;

alter table public.public_site_revisions
  add constraint public_site_revisions_status_known
    check (status in ('draft', 'in_review', 'published', 'archived', 'discarded')),
  add constraint public_site_revisions_lifecycle check (
    (status = 'draft' and submitted_at is null and published_at is null and discarded_at is null) or
    (status = 'in_review' and submitted_at is not null and published_at is null and discarded_at is null) or
    (status = 'published' and submitted_at is not null and published_at is not null and discarded_at is null) or
    (status = 'archived' and published_at is not null and archived_at is not null and discarded_at is null) or
    (status = 'discarded' and published_at is null and discarded_at is not null and discarded_by is not null));

-- Published, archived and discarded revisions are a fixed record. A discarded one never returns:
-- its content comes back only by restoring it into a new draft.
create or replace function app.guard_public_site_revision()
returns trigger language plpgsql set search_path = '' as $fn$
declare v_problem text;
begin
  if tg_op = 'INSERT' or new.pages is distinct from old.pages or new.navigation is distinct from old.navigation then
    v_problem := app.public_site_content_problem(new.pages, new.navigation);
    if v_problem is not null then
      raise exception 'the website does not match the supported vocabulary: %', v_problem using errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_path_query(new.pages, '$[*].sections[*] ? (@.kind == "form").formId') ref
       where not exists (
         select 1 from public.forms f
          where f.organization_id = new.organization_id and f.id = (ref #>> '{}')::uuid and f.archived_at is null)
    ) then
      raise exception 'the website names a form that does not exist in this organization' using errcode = '23503';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status in ('published', 'archived', 'discarded') and
     (new.pages is distinct from old.pages or new.navigation is distinct from old.navigation or
      new.revision_number is distinct from old.revision_number or
      new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by or
      new.base_revision_id is distinct from old.base_revision_id or
      new.copied_from_revision_id is distinct from old.copied_from_revision_id) then
    raise exception 'a published website revision is immutable' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.status = 'discarded' and new is distinct from old then
    raise exception 'a discarded website revision is a fixed record' using errcode = '55000';
  end if;
  return new;
end;
$fn$;

create or replace function app.prevent_published_site_revision_delete()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if old.status in ('published', 'archived', 'discarded') then
    raise exception 'a published website revision is immutable' using errcode = '55000';
  end if;
  return old;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Staleness and the experience a site is rendered as
-- ---------------------------------------------------------------------------

create function app.public_site_draft_is_stale(r public.public_site_revisions)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select case
    when r.status not in ('draft', 'in_review') then false
    when r.base_revision_id is not null then s.current_published_revision_id is distinct from r.base_revision_id
    -- Before bases were recorded: stale when anything was published after the draft was opened.
    else exists (
      select 1 from public.public_site_revisions p
       where p.organization_id = r.organization_id and p.site_id = r.site_id and p.id <> r.id
         and p.published_at > r.created_at)
  end
  from public.public_sites s
  where s.organization_id = r.organization_id and s.id = r.site_id;
$fn$;
revoke all on function app.public_site_draft_is_stale(public.public_site_revisions) from public, anon, authenticated;

-- GildOps' marketing site is drawn by its own code-owned compositions; every other site by the
-- business website frame. The renderer is chosen from this, never from a revision's content.
create function app.public_site_experience(p_organization_id uuid, p_site_id uuid)
returns text language sql stable security definer set search_path = '' as $fn$
  select case when exists (
    select 1 from public.platform_settings ps
     where ps.singleton and ps.gold_public_organization_id = p_organization_id and ps.gold_public_site_id = p_site_id)
  then 'gildops_marketing' else 'organization_website' end;
$fn$;
revoke all on function app.public_site_experience(uuid, uuid) from public, anon, authenticated;

create or replace function app.public_site_revision_json(r public.public_site_revisions)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('id', r.id, 'number', r.revision_number, 'status', r.status,
    'pages', r.pages, 'navigation', r.navigation, 'createdAt', r.created_at, 'createdSource', r.created_source,
    'updatedAt', r.updated_at, 'submittedAt', r.submitted_at, 'publishedAt', r.published_at,
    'baseRevisionId', r.base_revision_id,
    'baseRevisionNumber', (select b.revision_number from public.public_site_revisions b
                            where b.organization_id = r.organization_id and b.site_id = r.site_id and b.id = r.base_revision_id),
    'copiedFromRevisionId', r.copied_from_revision_id,
    'copiedFromRevisionNumber', (select c.revision_number from public.public_site_revisions c
                                  where c.organization_id = r.organization_id and c.site_id = r.site_id and c.id = r.copied_from_revision_id),
    'stale', app.public_site_draft_is_stale(r));
$fn$;
revoke all on function app.public_site_revision_json(public.public_site_revisions) from public, anon, authenticated;

create or replace function public.public_site_editor_state(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
    'siteId', s.id,
    'experience', app.public_site_experience(s.organization_id, s.id),
    'published', (select app.public_site_revision_json(r) from public.public_site_revisions r
                   where r.organization_id = s.organization_id and r.site_id = s.id and r.id = s.current_published_revision_id),
    'working', (select app.public_site_revision_json(r) from public.public_site_revisions r
                 where r.organization_id = s.organization_id and r.site_id = s.id and r.status in ('draft', 'in_review')),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'number', h.revision_number, 'status', h.status, 'createdAt', h.created_at,
        'createdSource', h.created_source, 'publishedAt', h.published_at, 'archivedAt', h.archived_at,
        'discardedAt', h.discarded_at,
        'copiedFromRevisionNumber', (select c.revision_number from public.public_site_revisions c
                                      where c.organization_id = h.organization_id and c.site_id = h.site_id and c.id = h.copied_from_revision_id))
        order by h.revision_number desc)
      from public.public_site_revisions h where h.organization_id = s.organization_id and h.site_id = s.id), '[]'::jsonb)
  ) into v_result
  from public.public_sites s where s.organization_id = p_organization_id;
  return v_result;
end;
$fn$;

-- What a private preview of one revision says about it, beside the snapshot itself: which revision
-- it is, where it stands against the published one, and which experience draws it.
create function public.public_site_revision_context(p_organization_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
    'experience', app.public_site_experience(r.organization_id, r.site_id),
    'revisionId', r.id, 'number', r.revision_number, 'status', r.status, 'createdSource', r.created_source,
    'stale', app.public_site_draft_is_stale(r),
    'publishedRevisionId', s.current_published_revision_id,
    'publishedRevisionNumber', (select p.revision_number from public.public_site_revisions p
                                 where p.organization_id = s.organization_id and p.id = s.current_published_revision_id))
    into v_result
    from public.public_site_revisions r
    join public.public_sites s on s.organization_id = r.organization_id and s.id = r.site_id
   where r.organization_id = p_organization_id and r.id = p_revision_id;
  return v_result;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Drafts: start, save, discard
-- ---------------------------------------------------------------------------

-- A new working draft from the published snapshot, or — to restore — from any earlier revision.
-- Restoring copies forward; with a draft already open it is refused rather than ignored.
create or replace function public.create_public_site_draft(p_organization_id uuid, p_from_revision_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid; v_site uuid; v_published uuid; v_source public.public_site_revisions;
  v_revision uuid; v_number integer;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select s.id, s.current_published_revision_id into v_site, v_published
    from public.public_sites s where s.organization_id = p_organization_id for update;
  if v_site is null then raise exception 'no public website is configured for this organization' using errcode = 'GD001'; end if;

  select id into v_revision from public.public_site_revisions
   where organization_id = p_organization_id and site_id = v_site and status in ('draft', 'in_review');
  if v_revision is not null then
    if p_from_revision_id is not null then
      raise exception 'this website already has a working draft: discard it before restoring another revision' using errcode = 'GD001';
    end if;
    return v_revision;
  end if;

  select r.* into v_source from public.public_site_revisions r
   where r.organization_id = p_organization_id and r.site_id = v_site
     and r.id = coalesce(p_from_revision_id, v_published);
  if v_source.id is null then raise exception 'there is no revision to start from' using errcode = 'GD001'; end if;

  select coalesce(max(revision_number), 0) + 1 into v_number from public.public_site_revisions
   where organization_id = p_organization_id and site_id = v_site;
  insert into public.public_site_revisions (
    organization_id, site_id, revision_number, status, pages, navigation, created_source, created_by,
    base_revision_id, copied_from_revision_id)
  values (p_organization_id, v_site, v_number, 'draft', v_source.pages, v_source.navigation, 'account', v_actor,
    v_published, v_source.id)
  returning id into v_revision;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', v_revision,
          case when v_source.id is distinct from v_published then 'public_site.restored' else 'public_site.draft_created' end,
          jsonb_build_object('revision_number', v_number, 'copied_from', v_source.id,
                             'copied_from_number', v_source.revision_number, 'base_revision_id', v_published));
  return v_revision;
end;
$fn$;

create or replace function public.update_public_site_draft(p_organization_id uuid, p_revision_id uuid, p_pages jsonb, p_navigation jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  update public.public_site_revisions set pages = p_pages, navigation = p_navigation, updated_at = now()
   where organization_id = p_organization_id and id = p_revision_id and status = 'draft'
  returning id into v_found;
  if v_found is null then raise exception 'only a draft in this organization can be edited' using errcode = 'GD001'; end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', p_revision_id, 'public_site.draft_updated', '{}'::jsonb);
end;
$fn$;

-- Ends the working draft (or a revision in review) without publishing it. The row stays as a
-- read-only record; the published revision and history are untouched.
create function public.discard_public_site_draft(p_organization_id uuid, p_revision_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_revision public.public_site_revisions; v_published uuid; v_stale boolean;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select r.* into v_revision from public.public_site_revisions r
   where r.organization_id = p_organization_id and r.id = p_revision_id and r.status in ('draft', 'in_review')
     for update;
  if v_revision.id is null then
    raise exception 'only a working draft in this organization can be discarded' using errcode = 'GD001';
  end if;
  select current_published_revision_id into v_published from public.public_sites
   where organization_id = p_organization_id and id = v_revision.site_id;
  v_stale := app.public_site_draft_is_stale(v_revision);

  update public.public_site_revisions set status = 'discarded', discarded_at = now(), discarded_by = v_actor
   where organization_id = p_organization_id and id = p_revision_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', p_revision_id, 'public_site.draft_discarded',
          jsonb_build_object('revision_number', v_revision.revision_number, 'previous_status', v_revision.status,
                             'base_revision_id', v_revision.base_revision_id, 'published_revision_id', v_published,
                             'was_stale', v_stale));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Publishing refuses to replace newer content unless told to
-- ---------------------------------------------------------------------------

drop function public.publish_public_site_revision(uuid, uuid);

create function public.publish_public_site_revision(p_organization_id uuid, p_revision_id uuid, p_replace_newer boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare v_actor uuid; v_revision public.public_site_revisions; v_previous uuid; v_previous_number integer; v_stale boolean;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select r.* into v_revision from public.public_site_revisions r
   where r.organization_id = p_organization_id and r.id = p_revision_id and r.status = 'in_review' for update;
  if v_revision.id is null then raise exception 'only a revision in review can be published' using errcode = 'GD001'; end if;
  select current_published_revision_id into v_previous from public.public_sites
   where organization_id = p_organization_id and id = v_revision.site_id for update;
  v_stale := app.public_site_draft_is_stale(v_revision);
  if v_stale and not coalesce(p_replace_newer, false) then
    select revision_number into v_previous_number from public.public_site_revisions
     where organization_id = p_organization_id and id = v_previous;
    raise exception 'revision % was started before revision % was published; publishing it would replace newer content',
      v_revision.revision_number, v_previous_number using errcode = 'GD002';
  end if;
  if v_previous is not null then
    update public.public_site_revisions set status = 'archived', archived_at = now()
     where organization_id = p_organization_id and site_id = v_revision.site_id and id = v_previous and status = 'published';
  end if;
  update public.public_site_revisions set status = 'published', published_at = now(), published_by = v_actor
   where organization_id = p_organization_id and site_id = v_revision.site_id and id = p_revision_id;
  update public.public_sites set current_published_revision_id = p_revision_id
   where organization_id = p_organization_id and id = v_revision.site_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'public_site_revision', p_revision_id, 'public_site.published',
          jsonb_build_object('previous_revision_id', v_previous, 'base_revision_id', v_revision.base_revision_id,
                             'replaced_newer', v_stale));
end;
$fn$;

comment on function public.publish_public_site_revision(uuid, uuid, boolean) is
  'The only publish transition. Serializes the site, refuses a revision started before the current published one unless p_replace_newer confirms it, archives the previous immutable snapshot, advances the published pointer and records the accountable actor in one transaction.';

-- ---------------------------------------------------------------------------
-- Doors
-- ---------------------------------------------------------------------------

revoke all on function public.public_site_revision_context(uuid, uuid) from public, anon;
revoke all on function public.discard_public_site_draft(uuid, uuid) from public, anon;
revoke all on function public.publish_public_site_revision(uuid, uuid, boolean) from public, anon;
grant execute on function public.public_site_revision_context(uuid, uuid) to authenticated;
grant execute on function public.discard_public_site_draft(uuid, uuid) to authenticated;
grant execute on function public.publish_public_site_revision(uuid, uuid, boolean) to authenticated;
