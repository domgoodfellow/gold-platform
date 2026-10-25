-- Relationship stages can be removed only when nothing uses them (V1.4 work order, section 4).
-- contacts.stage_id is ON DELETE SET NULL, so a plain delete would silently strip the stage from
-- every contact on it; this function refuses instead, naming how many contacts and audiences
-- still use the stage. The stage row is locked first: assigning a contact to it takes a key-share
-- lock on the same row, so no assignment can slip in between the check and the delete.

create function public.delete_relationship_stage(p_organization_id uuid, p_stage_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_contacts integer; v_audiences integer;
begin
  perform app.require_capability(p_organization_id, 'field.manage');
  perform 1 from public.contact_relationship_stages where organization_id = p_organization_id and id = p_stage_id for update;
  if not found then raise exception 'No such stage here.' using errcode = '42501'; end if;
  select count(*) into v_contacts from public.contacts where organization_id = p_organization_id and stage_id = p_stage_id;
  select count(*) into v_audiences from public.marketing_audiences where organization_id = p_organization_id and stage_id = p_stage_id;
  if v_contacts > 0 or v_audiences > 0 then
    raise exception 'This stage is still used by % contact(s) and % marketing audience(s). Move them to another stage first.', v_contacts, v_audiences
      using errcode = '23503';
  end if;
  delete from public.contact_relationship_stages where organization_id = p_organization_id and id = p_stage_id;
end $$;
revoke all on function public.delete_relationship_stage(uuid, uuid) from public, anon;
grant execute on function public.delete_relationship_stage(uuid, uuid) to authenticated;

-- How many contacts sit on each stage, for the configuration list. Security invoker: RLS decides.
create function public.relationship_stage_usage(p_organization_id uuid)
returns table(stage_id uuid, contacts integer) language sql stable security invoker set search_path = '' as $$
  select c.stage_id, count(*)::integer from public.contacts c
  where c.organization_id = p_organization_id and c.stage_id is not null group by c.stage_id
$$;
revoke all on function public.relationship_stage_usage(uuid) from public, anon;
grant execute on function public.relationship_stage_usage(uuid) to authenticated;

notify pgrst, 'reload schema';
