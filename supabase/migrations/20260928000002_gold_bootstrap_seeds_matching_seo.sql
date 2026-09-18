-- A fresh bootstrap seeded the three-product homepage sections under the previous page title and
-- description (`20260927000001` replaced the sections only). Same function as
-- `20260916000004` made it, same behaviour; only the two SEO strings it writes into revision 1
-- change, to match the sections beside them. Deployments already bootstrapped are handled by
-- `20260928000001`.

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
    values(p_organization_id,v_page,1,'published','GOLD | Run your business from one connected system','Sales, operations and customer service in one connected system, configured around how your business actually runs. Request a demo.',app.default_gold_homepage_sections(),'migration',now(),now()) returning id into v_revision;
    update public.public_pages set current_published_revision_id=v_revision where organization_id=p_organization_id and id=v_page;
  end if;
  update public.platform_settings set gold_public_organization_id=p_organization_id,gold_public_site_id=v_site where singleton;
  return v_site;
end;
$fn$;

revoke all on function app.bootstrap_gold_public_site(uuid) from public, anon, authenticated;
