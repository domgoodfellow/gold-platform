-- GildOps' homepage stops leading with products the commercial catalogue does not list as available.
--
-- 20261109000002 opened the homepage with "a browser dialer or an AI receptionist" and listed the
-- Dialer, the AI receptionist and Customer Service as ready to use. The catalogue lists the browser
-- dialer, the AI receptionist and support cases as planned (platform_catalog_features), so the
-- public site may not present them as available (apps/web/lib/marketing/content.ts states each
-- product's availability; marketing-availability.test.ts checks it against the catalogue).
--
--   1. the homepage a new GildOps site starts from: it leads with products that are available or
--      in testing, says "Not yet available to new businesses." on each row that is not, and its
--      calls to action read "Request a consultation";
--   2. the search description bootstrap gives it, which no longer opens with the Dialer;
--   3. the published GildOps homepage, replaced by a new published version only when it is still
--      the one 20261109000002 wrote. A homepage published from Studio is left alone; the old
--      version is archived, never rewritten (app.guard_public_site_revision).

-- 1. The starting homepage.
create or replace function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select $json$[
    {"kind":"hero","variant":"left","eyebrow":"","heading":"AI, automation and business software, set up around how you work.","body":"Start with one product, such as online booking or workflow automation, or connect several so customers, jobs and invoices share one record. We set each one up with you, and you check it before it goes live.","primaryCta":{"label":"Request a consultation","href":"/demo"},"secondaryCta":{"label":"Browse products","href":"/products"}},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"Tools you can use on their own.","body":"No new system to adopt first. Add one where your team loses the most time.","items":[{"title":"Websites and forms","body":"Publish a website and forms in your business's name. Edit a draft, check it, then publish.","href":"/products#websites"},{"title":"Online booking","body":"Customers pick a service and a free time without phoning. Each booking lands on your schedule.","href":"/products#booking"},{"title":"Dialer","body":"Business calls in the browser, with a call list and a record of how each call went. Not yet available to new businesses.","href":"/dialer"}]},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"AI and automation, set up with you.","body":"We agree what it may do and when it hands over to a person. Your team tests it before any customer sees it.","items":[{"title":"Workflow automation","body":"Rules that act when something happens: send an email, update a customer, create or move a job. Every run is recorded.","href":"/products#automation"},{"title":"Business assistant","body":"Ask about your customers, jobs and invoices in plain words, and get answers from records you can already see. It changes nothing unless a person approves.","href":"/products#assistant"},{"title":"AI receptionist","body":"Answers calls to your business number with information you approve, and passes the caller to a person when needed. Not yet available to new businesses.","href":"/products#ai-receptionist"}]},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"Or connect several into one system.","body":"When sales and work share one customer record, nobody types a job in twice or asks a customer to repeat themselves.","items":[{"title":"Sales","body":"Customer records, a pipeline, tasks and email, with each customer’s history in one place.","href":"/sales"},{"title":"Operations","body":"Jobs, scheduling, dispatch, quotes, invoices and payments, from request to paid.","href":"/operations"},{"title":"Customer Service","body":"Calls, email and website conversations in one history, with support cases for anything that needs resolving. Not yet available to new businesses.","href":"/customer-service"}]},
    {"kind":"process","eyebrow":"","heading":"How a project runs.","items":[{"step":"01","title":"Tell us the job to be done","body":"Bookings taken by hand, follow-ups forgotten, the same customer details typed in twice. We start from the task, not a product list."},{"step":"02","title":"Agree scope and price","body":"What we set up, what connects to the tools you keep, and what is charged for setup, each month and by usage."},{"step":"03","title":"Set up and test","body":"Your team tries it on real work. Anything AI says is reviewed before a customer sees it."},{"step":"04","title":"Go live and adjust","body":"Launch when you are ready, then add or change products as the business changes."}]},
    {"kind":"trust","eyebrow":"","heading":"What you can count on.","items":[{"title":"One product is not a commitment","body":"Using one product does not mean moving the rest of your business into GildOps."},{"title":"You approve AI before it goes live","body":"You decide what an assistant may say and when a person takes over, and you test it first."},{"title":"Costs in writing","body":"Setup, ongoing fees and usage are listed separately in your quote."},{"title":"Plain about what is ready","body":"Every product says whether it is available, in testing or not yet available, so you know what you can start with now."}]},
    {"kind":"cta","heading":"What would you like to fix first?","body":"Tell us the task, the tools you use now and who does the work. We will tell you which product fits, what setting it up involves and what it costs.","primaryCta":{"label":"Request a consultation","href":"/demo"},"secondaryCta":{"label":"Browse products","href":"/products"}}
  ]$json$::jsonb;
$function$;

-- 2. Bootstrap, unchanged from 20261109000002 except the search description.
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
        'seoTitle', 'GildOps | AI, automation and business software',
        'seoDescription', 'Websites, online booking, workflow automation and connected sales and operations software, set up with you. Use one product or several.',
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

  -- Only the homepage 20261109000002 wrote: the hero that led with the Dialer and the AI receptionist.
  if not exists (
    select 1
      from jsonb_array_elements(v_prior.pages) as p(page),
           jsonb_array_elements(p.page -> 'sections') as s(section)
     where (p.page ->> 'isHome')::boolean
       and s.section ->> 'kind' = 'hero'
       and s.section ->> 'body' like 'Start with one tool, like a browser dialer or an AI receptionist%'
  ) then return; end if;

  select jsonb_agg(
           case when (page ->> 'isHome')::boolean then
             page || jsonb_build_object(
               'seoTitle', 'GildOps | AI, automation and business software',
               'seoDescription', 'Websites, online booking, workflow automation and connected sales and operations software, set up with you. Use one product or several.',
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
