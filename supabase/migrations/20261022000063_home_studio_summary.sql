-- Studio owns revision tables and intentionally revokes direct reads. Home needs only
-- bounded, authorized metadata, never editor content or another record authority.
create function public.home_studio_summary(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  with working as (
    select id,status,revision_number,created_at from public.public_site_revisions
    where organization_id=p_organization_id and status in ('draft','in_review')
  ), drafts as (
    select r.id,r.form_id,r.created_at,f.name from public.form_revisions r
    join public.forms f on f.organization_id=r.organization_id and f.id=r.form_id
    where r.organization_id=p_organization_id and r.status='draft' and f.archived_at is null
  ), published as (
    select r.id,r.revision_number,r.published_at from public.public_sites s
    join public.public_site_revisions r on r.organization_id=s.organization_id and r.id=s.current_published_revision_id
    where s.organization_id=p_organization_id and r.status='published'
  )
  select jsonb_build_object(
    'workingTotal',(select count(*) from working),
    'draftTotal',(select count(*) from drafts),
    'working',coalesce((select jsonb_agg(x order by x.created_at desc,x.id) from (select * from working order by created_at desc,id limit 5) x),'[]'::jsonb),
    'drafts',coalesce((select jsonb_agg(x order by x.created_at desc,x.id) from (select * from drafts order by created_at desc,id limit 5) x),'[]'::jsonb),
    'published',coalesce((select jsonb_agg(x order by x.published_at desc,x.id) from (select * from published order by published_at desc,id limit 5) x),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.home_studio_summary(uuid) from public,anon;
grant execute on function public.home_studio_summary(uuid) to authenticated;
comment on function public.home_studio_summary(uuid) is 'Read-only Studio metadata for Global Home. Requires the existing tenant Studio manager boundary; previews are bounded and contain no editor content.';
