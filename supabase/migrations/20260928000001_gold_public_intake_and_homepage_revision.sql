-- Two changes that ship together because the marketing site needs both at once.
--
-- 1. **One public intake, two kinds.** `request_workflow_review` was the marketing site's only
--    anonymous write, and its name had become wrong: the demo form is a qualified sales request
--    and `/contact` is a general inquiry, and neither is a "workflow review". Everything the old
--    function guaranteed is kept unchanged (I26): no organization parameter, the target read from
--    `platform_settings`, one customer plus one `customer.created` event, no select policy that
--    lets the caller read it back. Only the vocabulary moves — `p_kind` is 'demo' or 'contact',
--    and lands in the event payload as `source` so GOLD's own operator can tell the two apart.
--    Replaced rather than kept beside it: two functions writing the same rows would be a rule
--    copied rather than extracted.
--
-- 2. **The published homepage catches up with the shipped copy.** `20260927000001` replaced
--    `app.default_gold_homepage_sections()` for fresh bootstraps only, so an already-bootstrapped
--    deployment still renders revision 1. A published revision is immutable, so this archives it
--    and publishes the current default as a new revision — history is kept, nothing is edited.
--    It does so only while the published revision is still one the migrations wrote
--    (`created_source = 'migration'`): a homepage a person in GOLD reviewed and published through
--    the editor is theirs, and a migration must not overwrite it.

create function public.submit_public_inquiry(
  p_kind          text,
  p_name          text,
  p_business_name text,
  p_email         text,
  p_phone         text,
  p_context       text,
  p_team_size     text,
  p_business_type text,
  p_topic         text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_target   uuid;
  v_business text := btrim(p_business_name);
  v_person   text := btrim(p_name);
  v_label    text;
  v_customer uuid;
begin
  if v_actor is null then
    raise exception 'submit_public_inquiry requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_kind not in ('demo', 'contact') then
    raise exception 'unknown inquiry kind' using errcode = '22023';
  end if;

  -- A demo request is about a business; a general inquiry is from a person, who may not have one.
  -- The customer row is named for whichever the sender gave, never for a word the platform chose.
  v_label := case when p_kind = 'demo' then v_business else coalesce(nullif(v_business, ''), v_person) end;
  if coalesce(v_label, '') = '' then
    raise exception 'a name is required' using errcode = '23514';
  end if;

  select workflow_review_organization_id into v_target
  from public.platform_settings
  where singleton;

  -- Honest absence (D31): a deployment that has not run the snippet takes no inquiry rather
  -- than filing one nobody will ever see.
  if v_target is null then
    raise exception 'public intake is not configured on this deployment'
      using errcode = 'GD001';
  end if;

  insert into public.customers (organization_id, name, email, phone, created_by)
  values (v_target, v_label, nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), v_actor)
  returning id into v_customer;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    v_target, v_actor, 'customer', v_customer, 'customer.created',
    jsonb_build_object(
      'name', v_label,
      'source', p_kind,
      'contact_name', nullif(v_person, ''),
      'context', nullif(btrim(p_context), ''),
      'team_size', nullif(btrim(p_team_size), ''),
      'business_type', nullif(btrim(p_business_type), ''),
      'topic', nullif(btrim(p_topic), '')
    )
  );
end;
$fn$;

comment on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text) is
  'The only write a public marketing form may perform, for a demo request or a general contact inquiry. One customer row in GOLD''s own tenant, resolved from platform_settings rather than from anything the caller supplies (D17, D42, I26) -- and no select policy anywhere grants the caller a way to read it back afterward.';

revoke all on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text) to authenticated;

drop function public.request_workflow_review(text, text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- The homepage: a new published revision, only over one the migrations wrote
-- ---------------------------------------------------------------------------

do $publish$
declare
  v_org      uuid;
  v_page     uuid;
  v_current  uuid;
  v_sections jsonb;
  v_source   text;
  v_number   integer;
  v_revision uuid;
begin
  select ps.workflow_review_organization_id into v_org
  from public.platform_settings ps where ps.singleton;
  if v_org is null then return; end if;

  select p.id, p.current_published_revision_id into v_page, v_current
  from public.public_pages p
  join public.public_sites s on s.organization_id = p.organization_id and s.id = p.site_id
  where p.organization_id = v_org and p.page_key = 'home';
  if v_page is null or v_current is null then return; end if;

  select r.sections, r.created_source into v_sections, v_source
  from public.public_page_revisions r
  where r.organization_id = v_org and r.id = v_current;

  if v_source <> 'migration' or v_sections = app.default_gold_homepage_sections() then return; end if;

  select max(revision_number) + 1 into v_number
  from public.public_page_revisions where organization_id = v_org and page_id = v_page;

  update public.public_page_revisions
  set status = 'archived', archived_at = now()
  where organization_id = v_org and page_id = v_page and id = v_current;

  insert into public.public_page_revisions (
    organization_id, page_id, revision_number, status, seo_title, seo_description, sections,
    created_source, submitted_at, published_at
  ) values (
    v_org, v_page, v_number, 'published',
    'GOLD | Run your business from one connected system',
    'Sales, operations and customer service in one connected system, configured around how your business actually runs. Request a demo.',
    app.default_gold_homepage_sections(), 'migration', now(), now()
  ) returning id into v_revision;

  update public.public_pages set current_published_revision_id = v_revision
  where organization_id = v_org and id = v_page;
end
$publish$;
