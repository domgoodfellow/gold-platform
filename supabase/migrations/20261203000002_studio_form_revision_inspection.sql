-- An author may inspect exactly one revision of their own form without changing public state.
create function public.read_form_revision(p_organization_id uuid, p_form_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object('id', r.id, 'number', r.revision_number, 'status', r.status,
    'definition', r.definition, 'publishedAt', r.published_at)
  into v_result from public.form_revisions r
  where r.organization_id = p_organization_id and r.form_id = p_form_id and r.id = p_revision_id;
  return v_result;
end;
$fn$;
revoke all on function public.read_form_revision(uuid, uuid, uuid) from public;
grant execute on function public.read_form_revision(uuid, uuid, uuid) to authenticated;
