-- Service cards can link, a services section can be laid out as a list, and GildOps' own homepage
-- presents its products as tools, AI and automation, and connected applications. Four parts:
--   1. an internal link may carry an anchor after its path (`/products#booking`);
--   2. a `capabilities` section may say `variant` ('cards' or 'list'; absent means cards, so every
--      saved section keeps its look) and each card may carry its own internal `href`. This replaces
--      the renderer's habit of guessing a link from a card titled "Sales", which also fired on any
--      business's website that happened to use that title;
--   3. the homepage a new GildOps site starts from, and the search text bootstrap gives it;
--   4. the published GildOps homepage, replaced by a new published version only when it is still
--      the one 20261108000001 wrote. A homepage published from Studio is left alone; the old version
--      is archived, never rewritten (app.guard_public_site_revision).
-- packages/schemas/src/website.ts repeats parts 1 and 2 for better error messages.

-- 1. Internal links.
create or replace function app.public_internal_href_ok(p_href text)
returns boolean language sql immutable set search_path = '' as $fn$
  select p_href ~ '^(\/[A-Za-z0-9\-\/_]*(#[A-Za-z][A-Za-z0-9-]*)?|#[A-Za-z][A-Za-z0-9-]*)$';
$fn$;

create or replace function app.public_link_is_valid(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $fn$
  select app.jsonb_has_only_keys(p_value, array['label','href'])
    and jsonb_typeof(p_value -> 'label') = 'string'
    and length(btrim(p_value ->> 'label')) between 1 and 80
    and jsonb_typeof(p_value -> 'href') = 'string'
    and app.public_internal_href_ok(p_value ->> 'href');
$fn$;

-- 2. Cards that may link.
create or replace function app.public_card_items_are_valid(p_value jsonb, p_max integer)
returns boolean language sql immutable set search_path = '' as $fn$
  select jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) between 1 and p_max
    and coalesce((select bool_and(
      app.jsonb_has_only_keys(item, array['title','body','href'])
      and jsonb_typeof(item -> 'title') = 'string' and length(btrim(item ->> 'title')) between 1 and 120
      and jsonb_typeof(item -> 'body') = 'string' and length(btrim(item ->> 'body')) between 1 and 500
      and (not (item ? 'href') or (jsonb_typeof(item -> 'href') = 'string' and app.public_internal_href_ok(item ->> 'href')))
    ) from jsonb_array_elements(p_value) item), false);
$fn$;

-- Unchanged from 20261022000052 except the capabilities branch.
create or replace function app.public_section_problem(p_item jsonb)
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
    if not (app.jsonb_has_only_keys(p_item, array['id','kind','variant','eyebrow','heading','body','items'])
        and (not (p_item ? 'variant') or (jsonb_typeof(p_item -> 'variant') = 'string' and p_item ->> 'variant' in ('cards','list')))
        and app.public_text_ok(p_item,'eyebrow',0,100) and app.public_text_ok(p_item,'heading',1,240)
        and app.public_text_ok(p_item,'body',1,600) and app.public_card_items_are_valid(p_item -> 'items', 9)) then
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

-- 3. The starting homepage. Product groups are `list` sections whose rows link to the product
--    pages; the product inventory itself is apps/web/lib/marketing/content.ts.
create or replace function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select $json$[
    {"kind":"hero","variant":"left","eyebrow":"","heading":"AI, automation and business software, set up around how you work.","body":"Start with one tool, like a browser dialer or an AI receptionist, or connect several so calls, customers, jobs and invoices share one record. We set each one up for your business, and you check it before it goes live.","primaryCta":{"label":"Discuss your project","href":"/demo"},"secondaryCta":{"label":"Browse products","href":"/products"}},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"Tools you can use on their own.","body":"No new system to adopt first. Add one where your team loses the most time.","items":[{"title":"Dialer","body":"Make and take business calls in the browser, work through a call list and record how each call went.","href":"/dialer"},{"title":"Websites and forms","body":"Publish a website and forms in your business's name. Edit a draft, check it, then publish.","href":"/products#websites"},{"title":"Online booking","body":"Customers pick a service and a free time without phoning. Each booking lands on your schedule.","href":"/products#booking"}]},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"AI and automation, set up with you.","body":"We agree what it may do and when it hands over to a person. Your team tests it before any customer sees it.","items":[{"title":"AI receptionist","body":"Answers calls to your business number with the information you approve, and passes the caller to a person when needed.","href":"/products#ai-receptionist"},{"title":"Website chat assistant","body":"Answers visitors' questions from your published website. A visitor can ask for a person, and your team replies in the same conversation.","href":"/products#website-assistant"},{"title":"Workflow automation","body":"Rules that act when something happens: send an email, update a customer, create or move a job. Every run is recorded.","href":"/products#automation"}]},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"Or connect several into one system.","body":"When sales, work and service share one customer record, nobody types a job in twice or asks a customer to repeat themselves.","items":[{"title":"Sales","body":"Contacts, pipeline, tasks, calls and email on one customer record.","href":"/sales"},{"title":"Operations","body":"Jobs, scheduling, dispatch, quotes, invoices and payments, from request to paid.","href":"/operations"},{"title":"Customer Service","body":"Calls, email and website conversations in one history, with support cases for anything that needs resolving.","href":"/customer-service"}]},
    {"kind":"process","eyebrow":"","heading":"How a project runs.","items":[{"step":"01","title":"Tell us the job to be done","body":"A call list to work through, calls going unanswered, bookings taken by hand. We start from the task, not a product list."},{"step":"02","title":"Agree scope and price","body":"What we set up, what connects to the tools you keep, and what is charged for setup, each month and by usage."},{"step":"03","title":"Set up and test","body":"Your team tries it on real work. Anything AI says is reviewed before a customer hears it."},{"step":"04","title":"Go live and adjust","body":"Launch when you are ready, then add or change tools as the business changes."}]},
    {"kind":"trust","eyebrow":"","heading":"What you can count on.","items":[{"title":"One tool is not a commitment","body":"Using the Dialer or an assistant does not mean moving the rest of your business into GildOps."},{"title":"You approve AI before it goes live","body":"You decide what an assistant may say and when a person takes over, and you test it first."},{"title":"Costs in writing","body":"Setup, ongoing fees and usage such as call minutes are listed separately in your quote."},{"title":"A person can step in","body":"Calls and website conversations can be passed to your team, with what was already said kept on the record."}]},
    {"kind":"cta","heading":"What would you like to fix first?","body":"Tell us the task, the tools you use now and who does the work. We will tell you which product fits, what setting it up involves and what it costs.","primaryCta":{"label":"Discuss your project","href":"/demo"},"secondaryCta":{"label":"Browse products","href":"/products"}}
  ]$json$::jsonb;
$function$;

-- Bootstrap, unchanged from 20261108000001 except the search title and description.
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
        'seoDescription', 'A browser dialer, an AI receptionist, website chat, workflow automation and connected sales, operations and service software. Use one tool or several.',
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

-- 4. The published homepage, when migrations still own it.
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

  -- Only the homepage 20261108000001 wrote.
  if not exists (
    select 1
      from jsonb_array_elements(v_prior.pages) as p(page),
           jsonb_array_elements(p.page -> 'sections') as s(section)
     where (p.page ->> 'isHome')::boolean
       and s.section ->> 'kind' = 'hero'
       and s.section ->> 'heading' = 'AI solutions set up for your business.'
  ) then return; end if;

  select jsonb_agg(
           case when (page ->> 'isHome')::boolean then
             page || jsonb_build_object(
               'seoTitle', 'GildOps | AI, automation and business software',
               'seoDescription', 'A browser dialer, an AI receptionist, website chat, workflow automation and connected sales, operations and service software. Use one tool or several.',
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
