-- A bounded page of responses, with the same authorization and historical definitions as the
-- existing latest-responses read. The original RPC stays available for existing consumers.
create function public.list_form_submission_page(
  p_organization_id uuid, p_form_id uuid, p_offset integer default 0, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not exists (select 1 from public.forms where organization_id = p_organization_id and id = p_form_id) then
    return null;
  end if;
  with page as materialized (
    select s.* from public.form_submissions s
    where s.organization_id = p_organization_id and s.form_id = p_form_id
    order by s.submitted_at desc, s.id desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from public.form_submissions where organization_id = p_organization_id and form_id = p_form_id),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'submittedAt', s.submitted_at, 'revisionId', s.form_revision_id,
      'source', s.source, 'answers', s.answers, 'customerId', s.customer_id,
      'customerName', c.name, 'bookingWorkItemId', s.booking_work_item_id
    ) order by s.submitted_at desc, s.id desc)
      from page s left join public.customers c on c.organization_id = s.organization_id and c.id = s.customer_id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.revision_number, 'definition', r.definition))
      from public.form_revisions r where r.organization_id = p_organization_id and r.form_id = p_form_id
        and r.id in (select form_revision_id from page)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$fn$;
revoke all on function public.list_form_submission_page(uuid, uuid, integer, integer) from public;
grant execute on function public.list_form_submission_page(uuid, uuid, integer, integer) to authenticated;
