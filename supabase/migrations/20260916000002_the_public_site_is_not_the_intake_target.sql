-- GOLD's public identity and its workflow-review intake happen to name the same organization in
-- today's deployment, but they are different authorities. Publishing must not silently retarget
-- customer intake, and changing intake must not make the homepage disappear.

alter table public.platform_settings drop constraint platform_settings_gold_public_site_fk;
alter table public.public_sites add constraint public_sites_id_unique unique (id);
alter table public.platform_settings add constraint platform_settings_gold_public_site_fk
  foreign key (gold_public_site_id) references public.public_sites (id);

create or replace function public.published_gold_homepage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'siteId', s.id, 'organizationId', s.organization_id, 'pageId', p.id,
    'revisionId', r.id, 'revisionNumber', r.revision_number,
    'seoTitle', r.seo_title, 'seoDescription', r.seo_description, 'sections', r.sections,
    'profile', jsonb_build_object(
      'displayName', coalesce(op.display_name, o.name), 'tagline', op.tagline,
      'intro', op.intro, 'contactEmail', op.contact_email,
      'contactPhone', op.contact_phone, 'address', op.address
    ),
    'brand', jsonb_build_object(
      'accent', b.accent, 'headingFont', coalesce(b.heading_font, 'sans'),
      'bodyFont', coalesce(b.body_font, 'sans'), 'logoPath', b.logo_path
    )
  )
  from public.platform_settings ps
  join public.public_sites s on s.id = ps.gold_public_site_id
  join public.public_pages p on p.organization_id = s.organization_id and p.site_id = s.id and p.page_key = 'home'
  join public.public_page_revisions r on r.organization_id = p.organization_id
    and r.page_id = p.id and r.id = p.current_published_revision_id and r.status = 'published'
  join public.organizations o on o.id = s.organization_id
  left join public.organization_profiles op on op.organization_id = o.id
  left join public.brand_settings b on b.organization_id = o.id
  where ps.singleton;
$fn$;

create or replace function app.bootstrap_gold_public_site(p_organization_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_site uuid; v_page uuid; v_revision uuid;
begin
  if not exists (select 1 from public.organizations where id=p_organization_id) then
    raise exception 'the GOLD organization does not exist' using errcode='23503';
  end if;
  insert into public.public_sites (organization_id,created_by) values (p_organization_id,null)
    on conflict (organization_id) do update set default_locale=public.public_sites.default_locale returning id into v_site;
  insert into public.public_pages (organization_id,site_id,page_key,slug) values (p_organization_id,v_site,'home','')
    on conflict (organization_id,site_id,page_key) do update set page_key=excluded.page_key
    returning id,current_published_revision_id into v_page,v_revision;
  if v_revision is null then
    insert into public.public_page_revisions
      (organization_id,page_id,revision_number,status,seo_title,seo_description,sections,created_source,submitted_at,published_at)
    values (p_organization_id,v_page,1,'published','GOLD | One operating system for your business',
      'Connect work, customers, scheduling, communications, payments and automation in one configurable business system.',
      app.default_gold_homepage_sections(),'migration',now(),now()) returning id into v_revision;
    update public.public_pages set current_published_revision_id=v_revision
      where organization_id=p_organization_id and id=v_page;
  end if;
  update public.platform_settings set gold_public_site_id=v_site where singleton;
  return v_site;
end;
$fn$;

revoke all on function app.bootstrap_gold_public_site(uuid) from public, anon, authenticated;
revoke all on function public.published_gold_homepage() from public;
grant execute on function public.published_gold_homepage() to anon, authenticated;
