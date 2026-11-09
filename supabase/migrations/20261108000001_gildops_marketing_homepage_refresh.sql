-- GildOps' own homepage: new text and search title, and no illustrated dashboard in the hero
-- (variant 'left' instead of 'preview'). Three parts:
--   1. the homepage a new GildOps site starts from;
--   2. the search title and description that bootstrap gives it;
--   3. the currently published homepage, replaced by a new published version only when it is
--      still the one migrations wrote with the old text. A homepage somebody published from
--      Studio is left alone. Published versions are a fixed record, so the old one is archived,
--      never rewritten (app.guard_public_site_revision).

-- 1. The starting homepage. Eyebrows are empty and the hero variant is explicit:
--    app.with_section_ids gives a hero with no variant the dashboard picture ('preview').
create or replace function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select $json$[
    {"kind":"hero","variant":"left","eyebrow":"","heading":"AI solutions set up for your business.","body":"Add an AI receptionist, a customer support assistant or an automated workflow. Start with what you need, set up around how your business operates.","primaryCta":{"label":"Discuss your project","href":"/demo"},"secondaryCta":{"label":"How it works","href":"/how-it-works"}},
    {"kind":"problem","heading":"Improve the work. Keep what already works.","paragraphs":["Repetitive questions, manual handoffs and disconnected processes take time away from the work your team does best.","GildOps sets up AI assistants and automations for specific tasks. You can start with one solution without replacing every system your business already uses."]},
    {"kind":"capabilities","eyebrow":"","heading":"Start with the part of your business you want to improve.","body":"Choose a focused solution now. Add others only when they are useful.","items":[{"title":"Sales","body":"Keep leads, conversations and follow-up organized without repetitive administration."},{"title":"Operations","body":"Reduce manual coordination across scheduling, work and routine processes."},{"title":"Customer Service","body":"Use AI-assisted responses and clear handoffs for common customer questions."}]},
    {"kind":"process","eyebrow":"","heading":"From a specific need to a working solution.","items":[{"step":"01","title":"Tell us what needs improving","body":"We identify the task, the current process and the systems involved."},{"step":"02","title":"Scope the solution","body":"We explain what can be set up, what needs integrating and what it will cost."},{"step":"03","title":"Set up and test","body":"Review the behavior with your team before using it with customers or live work."},{"step":"04","title":"Launch and refine","body":"Start with the approved workflow and improve it as requirements change."}]},
    {"kind":"trust","eyebrow":"","heading":"Focused implementation, clear controls.","items":[{"title":"Only what you need","body":"A receptionist or support assistant does not require a full business-platform migration."},{"title":"Review before launch","body":"You review the setup and how it behaves before it goes live."},{"title":"Human escalation","body":"AI-assisted interactions can be set up to involve your team when needed."},{"title":"Defined scope","body":"We distinguish included setup, integration work and ongoing usage when quoting."}]},
    {"kind":"cta","heading":"What would you like to automate?","body":"Tell us about a task, process or customer interaction. We will discuss a practical solution and the work required to implement it.","primaryCta":{"label":"Discuss your project","href":"/demo"},"secondaryCta":{"label":"See how it works","href":"/how-it-works"}}
  ]$json$::jsonb;
$function$;

-- 2. Bootstrap, unchanged except for the search title and description.
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
        'seoTitle', 'GildOps | Tailored AI and business automation',
        'seoDescription', 'AI receptionists, customer support assistants and workflow automations set up for your business.',
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

-- 3. The published homepage, when migrations still own it.
do $refresh$
declare
  v_org uuid;
  v_site uuid;
  v_current uuid;
  v_prior public.public_site_revisions%rowtype;
  v_pages jsonb;
  v_new uuid;
  v_number integer;
begin
  select ps.gold_public_organization_id, ps.gold_public_site_id
    into v_org, v_site
    from public.platform_settings ps where ps.singleton;
  if v_org is null or v_site is null then return; end if;

  select s.current_published_revision_id into v_current
    from public.public_sites s
   where s.organization_id = v_org and s.id = v_site
     for update;
  if v_current is null then return; end if;

  select * into v_prior
    from public.public_site_revisions r
   where r.organization_id = v_org and r.site_id = v_site and r.id = v_current;
  if not found or v_prior.status <> 'published' or v_prior.created_source <> 'migration' then return; end if;

  -- Only the homepage migrations wrote with the old text.
  if not exists (
    select 1
      from jsonb_array_elements(v_prior.pages) as p(page),
           jsonb_array_elements(p.page -> 'sections') as s(section)
     where (p.page ->> 'isHome')::boolean
       and s.section ->> 'kind' = 'hero'
       and s.section ->> 'heading' = 'Run your business from one connected system.'
  ) then return; end if;

  -- The home page takes the new starting homepage; any other page is kept as it is.
  select jsonb_agg(
           case when (page ->> 'isHome')::boolean then
             page || jsonb_build_object(
               'seoTitle', 'GildOps | Tailored AI and business automation',
               'seoDescription', 'AI receptionists, customer support assistants and workflow automations set up for your business.',
               'sections', app.with_section_ids(app.default_gold_homepage_sections()))
           else page end
           order by page_position)
    into v_pages
    from jsonb_array_elements(v_prior.pages) with ordinality as page_rows(page, page_position);

  select coalesce(max(revision_number), 0) + 1 into v_number
    from public.public_site_revisions
   where organization_id = v_org and site_id = v_site;

  -- Archive first: a site has at most one published version (public_site_one_published_revision).
  update public.public_site_revisions
     set status = 'archived', archived_at = now()
   where organization_id = v_org and site_id = v_site and id = v_current;

  insert into public.public_site_revisions (
    organization_id, site_id, revision_number, status, pages, navigation,
    created_source, submitted_at, published_at
  ) values (
    v_org, v_site, v_number, 'published', v_pages, v_prior.navigation,
    'migration', now(), now()
  ) returning id into v_new;

  update public.public_sites
     set current_published_revision_id = v_new
   where organization_id = v_org and id = v_site;
end
$refresh$;
