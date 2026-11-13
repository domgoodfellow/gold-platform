-- The Dialer's call list is the set of open Call tasks. This makes "one entry per contact" a
-- database rule rather than a read-before-insert check, and makes taking someone off the list its
-- own permission (`call_list.remove`) that broader task permission cannot route around.

-- 1. The permission. Administrators (roles that already change business settings) receive it, the
--    same forward backfill `follow_up.manage` used; every other role is granted it explicitly.
do $$
declare v_known text[]; v_constraint text;
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_known from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  if not 'call_list.remove' = any(v_known) then
    v_known := v_known || array['call_list.remove'];
  end if;
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',' order by c) from unnest(v_known) c));
end $$;
-- Only adds a permission, so it cannot leave a business without someone who manages roles; the
-- guard for that is set aside for this statement because it also refuses any change at all in a
-- business that already has nobody holding `role.manage` (seen in existing data).
alter table public.roles disable trigger roles_capabilities_update_guard;
update public.roles set capabilities = capabilities || array['call_list.remove']
  where 'organization.manage' = any(capabilities) and not 'call_list.remove' = any(capabilities);
alter table public.roles enable trigger roles_capabilities_update_guard;

-- 2. Existing duplicates. Before the rule can exist, a contact with several open Call tasks keeps
--    the one due first (then the one created first, then the lowest id, so the choice is the same on
--    every run); the others are cancelled, never deleted, and each cancellation is recorded in the
--    event log. Nobody decided these, so the actor is the data migration account: a real
--    `auth.users` row that can never sign in, the answer the payment integration (…a1) and
--    automations (…a2) already use. The task's creator is kept beside it in the payload.
insert into auth.users (id, instance_id, aud, role)
values ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;
alter table public.crm_tasks disable trigger follow_up_observed;
with ranked as (
  select id, row_number() over (partition by organization_id, customer_id order by due_at, created_at, id) as position
    from public.crm_tasks where status = 'open' and kind = 'call'
), cancelled as (
  update public.crm_tasks t set status = 'cancelled'
    from ranked r where t.id = r.id and r.position > 1
  returning t.*
)
insert into public.events(organization_id, actor_id, entity_type, entity_id, action, payload)
  select organization_id, '00000000-0000-4000-8000-0000000000a3', 'follow_up', id, 'follow_up.cancelled',
    jsonb_build_object('customer_id', customer_id, 'opportunity_id', opportunity_id, 'title', title, 'kind', kind,
      'due_at', due_at, 'status', 'cancelled', 'owner_membership_id', owner_membership_id,
      'reason', 'duplicate_call_list_entry', 'recorded_by', 'migration',
      'migration', '20261113000001_one_call_list_entry_and_explicit_removal', 'task_created_by', created_by)
  from cancelled;
alter table public.crm_tasks enable trigger follow_up_observed;

-- 3. One open Call task per contact. A completed or cancelled one never blocks adding them again.
create unique index crm_tasks_one_open_call_per_contact on public.crm_tasks(organization_id, customer_id)
  where status = 'open' and kind = 'call';

-- 4. Taking someone off the call list needs `call_list.remove` however it is attempted: cancelling
--    the open Call task, or changing its kind so it leaves the list. This sits on the table, so the
--    CRM Tasks screen, the `crm_follow_ups` compatibility view and any future function are held to
--    it as well as the Dialer. Completing the call is not removal and stays with task permission.
create function app.guard_call_list_removal() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'open' and old.kind = 'call' and (new.status = 'cancelled' or new.kind is distinct from 'call')
     and not app.has_capability(old.organization_id, 'call_list.remove') then
    raise exception 'Your role cannot remove contacts from the call list.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app.guard_call_list_removal() from public, anon, authenticated;
-- Named to fire before `follow_up_observed`, so a refused removal records nothing.
create trigger call_list_removal_guarded before update on public.crm_tasks
  for each row execute function app.guard_call_list_removal();

-- 5. Adding: every eligible contact in one statement. A contact someone else put on the list a
--    moment earlier is skipped by the unique rule instead of failing the whole add, and only the
--    contacts actually added are returned, so the caller can count additions and conflicts exactly.
--    Invoker rights: row security and column grants still require `follow_up.manage`, and only
--    contacts the caller can see are added (20261113000002 also leaves archived contacts out).
create function public.add_call_list_entries(
  p_organization_id uuid, p_customer_ids uuid[], p_title text, p_due_at timestamptz,
  p_owner_membership_id uuid default null, p_notes text default null
) returns setof uuid language sql volatile security invoker set search_path = '' as $$
  insert into public.crm_tasks(organization_id, customer_id, kind, title, notes, due_at, owner_membership_id, created_by)
    select p_organization_id, c.id, 'call', btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_due_at,
      p_owner_membership_id, (select auth.uid())
      from public.contacts c
     where c.organization_id = p_organization_id and c.id = any (p_customer_ids)
  on conflict (organization_id, customer_id) where status = 'open' and kind = 'call' do nothing
  returning customer_id
$$;
revoke all on function public.add_call_list_entries(uuid, uuid[], text, timestamptz, uuid, text) from public, anon;
grant execute on function public.add_call_list_entries(uuid, uuid[], text, timestamptz, uuid, text) to authenticated;

-- 6. Removing: cancels the one open Call task named, nothing else. The contact, their completed
--    calls, notes and history are untouched, and a call already in progress is not a task, so it
--    carries on. Needs `call_list.remove` only; it does not need permission to edit tasks.
create function public.remove_from_call_list(p_organization_id uuid, p_task_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_capability(p_organization_id, 'call_list.remove');
  update public.crm_tasks set status = 'cancelled'
    where organization_id = p_organization_id and id = p_task_id and status = 'open' and kind = 'call';
  if not found then
    raise exception 'This contact is no longer on the call list.' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.remove_from_call_list(uuid, uuid) from public, anon;
grant execute on function public.remove_from_call_list(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
