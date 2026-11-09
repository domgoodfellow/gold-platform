-- On screen, CRM tasks are called Tasks. A follow-up is one reason for a task, not the name of
-- the list. The catalogue feature keeps its key (`follow_ups`) and the trigger keeps its name, so
-- nothing that refers to them moves; only the words people read change.

update public.platform_catalog_features
  set label = 'Tasks', description = 'Calls, emails, meetings and other tasks for a contact, with their calendar.'
  where key = 'follow_ups';

-- The live definition from 20261022000056, with only the exception message reworded.
create or replace function app.observe_follow_up() returns trigger language plpgsql set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'UPDATE' and old.status <> 'open' and new is distinct from old then
    raise exception 'A completed or cancelled task cannot be changed. Add a new task instead.' using errcode = '23514';
  end if;
  if new.status = 'completed' then
    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(old.completed_by, auth.uid());
  end if;
  if tg_op = 'INSERT' then v_action := 'follow_up.created';
  elsif new is not distinct from old then return new;
  elsif new.status = 'completed' then v_action := 'follow_up.completed';
  elsif new.status = 'cancelled' then v_action := 'follow_up.cancelled';
  else v_action := 'follow_up.updated'; end if;
  insert into public.events(organization_id, actor_id, entity_type, entity_id, action, payload)
    values(new.organization_id, auth.uid(), 'follow_up', new.id, v_action,
      jsonb_build_object('customer_id',new.customer_id,'opportunity_id',new.opportunity_id,'title',new.title,'kind',new.kind,
        'due_at',new.due_at,'status',new.status,'owner_membership_id',new.owner_membership_id,
        'before',case when tg_op = 'UPDATE' then to_jsonb(old) else null end));
  return new;
end $$;
revoke all on function app.observe_follow_up() from public;
