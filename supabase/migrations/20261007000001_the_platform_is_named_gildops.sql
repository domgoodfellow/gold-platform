-- The platform's public name is GildOps. The published homepage is a database revision, not
-- static content, so its "GOLD" copy survived every code change: it was written by
-- `20260927000001` / `20260928000001` / `20260928000002`, and a migration-written revision is only
-- ever replaced by a later migration.
--
-- Three things change, all of them the same shape as before and none of them a rename of an
-- identifier: the default homepage sections and the bootstrap's SEO strings (for a fresh
-- deployment), and the published revision itself (for one already bootstrapped). Function and
-- column names keep "gold" -- they name the operator organization's role, and renaming them would
-- touch every migration and grant that refers to them for no visible gain.
--
-- A published revision is immutable, so it is archived and the new copy published as the next
-- revision: history kept, nothing edited. It happens only while the published revision is still
-- one migrations wrote (`created_source = 'migration'`) -- a homepage a person reviewed and
-- published through the editor is theirs, and a migration must not overwrite it. The operator
-- organization's own name is data, and this does not touch it.

create or replace function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select $json$[
    {"kind":"hero","eyebrow":"One system, not six","heading":"Run your business from one connected system.","body":"GildOps brings your sales, customers, communication, scheduling, work, automation, payments and reporting together — then configures itself around how your business actually runs.","primaryCta":{"label":"Request a demo","href":"/demo"},"secondaryCta":{"label":"See how GildOps works","href":"#how-it-works"}},
    {"kind":"problem","heading":"The problem isn’t one bad tool. It’s the gap between all of them.","paragraphs":["Customer details live in one place. Calls and texts happen somewhere else. Jobs get tracked in a spreadsheet, and nobody has one view of what a customer is waiting on.","GildOps keeps that information together, so the next call, quote or job starts from the full picture instead of another round of asking the customer to repeat themselves."]},
    {"kind":"capabilities","eyebrow":"Three ways in","heading":"Pick where GildOps helps first.","body":"Sales, Operations and Customer Service each stand on their own — turn on what your business needs now, and add the rest later.","items":[{"title":"Sales","body":"Turn leads into customers without losing the conversation."},{"title":"Operations","body":"Know what needs to happen, who is doing it, and what happens next."},{"title":"Customer Service","body":"Give customers one conversation with your business."}]},
    {"kind":"process","eyebrow":"How it works","heading":"You review every step before it goes live.","items":[{"step":"01","title":"See how you work today","body":"A short conversation about the tools you use now and where they fall short."},{"step":"02","title":"Configure your workspace","body":"Your services, pricing, hours and roles get set up — not a template, your operation."},{"step":"03","title":"Review and launch","body":"Test the real workflows with your team, then launch only when you’re ready."},{"step":"04","title":"Improve over time","body":"Turn on more of GildOps as the business needs it, without starting over."}]},
    {"kind":"trust","eyebrow":"Why GildOps","heading":"Built so you can trust what it does.","items":[{"title":"Your data stays yours","body":"Every business’s records stay separate, from the screen through the database."},{"title":"A person stays in the loop","body":"AI can draft and assist; it does not act or publish on its own."},{"title":"Configured for you, not a template","body":"Your work types, pricing and roles reflect how you actually run — no fork to maintain."},{"title":"You decide when to launch","body":"Nothing goes live for your business until you’ve reviewed it."}]},
    {"kind":"cta","heading":"Run your business from one connected system.","body":"Request a demo and we’ll show you where GildOps fits — starting with the parts your business needs most.","primaryCta":{"label":"Request a demo","href":"/demo"},"secondaryCta":{"label":"Prefer to explore independently? Create an account.","href":"/sign-up"}}
  ]$json$::jsonb;
$fn$;

create or replace function app.bootstrap_gold_public_site(p_organization_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $fn$
declare v_site uuid; v_page uuid; v_revision uuid;
begin
  if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'the GOLD organization does not exist' using errcode='23503'; end if;
  insert into public.public_sites(organization_id,created_by) values(p_organization_id,null)
    on conflict(organization_id) do update set default_locale=public.public_sites.default_locale returning id into v_site;
  insert into public.public_pages(organization_id,site_id,page_key,slug) values(p_organization_id,v_site,'home','')
    on conflict(organization_id,site_id,page_key) do update set page_key=excluded.page_key returning id,current_published_revision_id into v_page,v_revision;
  if v_revision is null then
    insert into public.public_page_revisions(organization_id,page_id,revision_number,status,seo_title,seo_description,sections,created_source,submitted_at,published_at)
    values(p_organization_id,v_page,1,'published','GildOps | Run your business from one connected system','Sales, operations and customer service in one connected system, configured around how your business actually runs. Request a demo.',app.default_gold_homepage_sections(),'migration',now(),now()) returning id into v_revision;
    update public.public_pages set current_published_revision_id=v_revision where organization_id=p_organization_id and id=v_page;
  end if;
  update public.platform_settings set gold_public_organization_id=p_organization_id,gold_public_site_id=v_site where singleton;
  return v_site;
end;
$fn$;

revoke all on function app.bootstrap_gold_public_site(uuid) from public, anon, authenticated;

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
  -- The organization that owns the platform's root site, which is not necessarily the intake target
  -- (`20260916000002`).
  select ps.gold_public_organization_id into v_org
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
    'GildOps | Run your business from one connected system',
    'Sales, operations and customer service in one connected system, configured around how your business actually runs. Request a demo.',
    app.default_gold_homepage_sections(), 'migration', now(), now()
  ) returning id into v_revision;

  update public.public_pages set current_published_revision_id = v_revision
  where organization_id = v_org and id = v_page;
end
$publish$;
