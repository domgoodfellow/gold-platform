-- This slice proves GOLD's configured platform-domain site. It does not silently provision a
-- GOLD-worded website for every tenant that opens Configuration Center; hostname/site
-- provisioning belongs to the later distribution slice.
create or replace function public.create_public_homepage_draft(p_organization_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $fn$
declare v_actor uuid; v_page uuid; v_revision uuid; v_number integer;
begin
  v_actor:=app.require_public_site_manager(p_organization_id);
  select p.id into v_page from public.public_sites s
  join public.public_pages p on p.organization_id=s.organization_id and p.site_id=s.id and p.page_key='home'
  where s.organization_id=p_organization_id;
  if v_page is null then raise exception 'no public website is configured for this organization' using errcode='GD001'; end if;
  select id into v_revision from public.public_page_revisions where organization_id=p_organization_id and page_id=v_page and status in('draft','in_review');
  if v_revision is not null then return v_revision; end if;
  select coalesce(max(revision_number),0)+1 into v_number from public.public_page_revisions where organization_id=p_organization_id and page_id=v_page;
  insert into public.public_page_revisions(organization_id,page_id,revision_number,status,seo_title,seo_description,sections,created_source,created_by)
  select p_organization_id,v_page,v_number,'draft',r.seo_title,r.seo_description,r.sections,'account',v_actor
  from public.public_pages p join public.public_page_revisions r
    on r.organization_id=p.organization_id and r.page_id=p.id and r.id=p.current_published_revision_id
  where p.organization_id=p_organization_id and p.id=v_page
  returning id into v_revision;
  if v_revision is null then raise exception 'a configured website needs a published revision before drafting' using errcode='GD001'; end if;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,v_actor,'public_page_revision',v_revision,'public_page.draft_created',jsonb_build_object('revision_number',v_number));
  return v_revision;
end;
$fn$;
revoke all on function public.create_public_homepage_draft(uuid) from public;
grant execute on function public.create_public_homepage_draft(uuid) to authenticated;
