-- Read-only preflight for 20261113000001 to 20261113000003 (call list, contact permissions and
-- removal, import review). Run it against the target database before applying them:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/preflight/20261113_contacts_and_call_list.sql
--
-- Everything runs in a read-only transaction that is rolled back; nothing is written.
begin transaction read only;

\echo '1. Already applied? (all false before the release)'
select
  exists (select 1 from pg_indexes where indexname = 'crm_tasks_one_open_call_per_contact') as one_open_call_rule,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'archived_at') as contact_archive,
  coalesce((select pg_get_constraintdef(oid) like '%customer.read%' from pg_constraint where conname = 'roles_capabilities_known'), false) as contact_read_permission,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'import_staging_rows' and column_name = 'match_reason') as import_review;

\echo '2. Duplicate open Call tasks the first migration cancels (keeps the one due first, then created first, then lowest id)'
with open_calls as (
  select organization_id, customer_id, id,
         row_number() over (partition by organization_id, customer_id order by due_at, created_at, id) as position,
         count(*) over (partition by organization_id, customer_id) as open_for_contact
    from public.crm_tasks where status = 'open' and kind = 'call'
)
select count(distinct (organization_id, customer_id)) filter (where open_for_contact > 1) as contacts_affected,
       count(*) filter (where open_for_contact > 1) as open_call_tasks_on_those_contacts,
       count(*) filter (where position > 1) as tasks_to_cancel,
       count(distinct organization_id) filter (where position > 1) as businesses_affected
  from open_calls;

\echo '2a. Per business (largest first)'
with open_calls as (
  select organization_id, customer_id,
         row_number() over (partition by organization_id, customer_id order by due_at, created_at, id) as position
    from public.crm_tasks where status = 'open' and kind = 'call'
)
select organization_id, count(distinct customer_id) as contacts, count(*) as tasks_to_cancel
  from open_calls where position > 1 group by organization_id order by tasks_to_cancel desc limit 50;

\echo '2b. Every task the cleanup would cancel, with the one kept for the same contact'
with open_calls as (
  select organization_id, customer_id, id, title, due_at, created_by,
         row_number() over (partition by organization_id, customer_id order by due_at, created_at, id) as position,
         first_value(id) over (partition by organization_id, customer_id order by due_at, created_at, id) as kept_task
    from public.crm_tasks where status = 'open' and kind = 'call'
)
select organization_id, customer_id, id as task_to_cancel, kept_task, title, due_at, created_by as original_creator
  from open_calls where position > 1 order by organization_id, customer_id, due_at limit 500;

\echo '3. Role grants the migrations add'
select count(*) filter (where not 'customer.read' = any(capabilities)) as roles_gaining_view_contacts,
       count(*) filter (where 'organization.manage' = any(capabilities) and not 'customer.delete' = any(capabilities)) as roles_gaining_delete_contacts,
       count(*) filter (where 'organization.manage' = any(capabilities) and not 'call_list.remove' = any(capabilities)) as roles_gaining_call_list_removal,
       count(*) as roles_total
  from public.roles;

\echo '3a. Roles that manage tasks but will not be able to cancel Call tasks until granted call_list.remove'
select r.organization_id, r.id as role_id, r.name, count(m.id) as members
  from public.roles r left join public.memberships m on m.role_id = r.id
 where 'follow_up.manage' = any(r.capabilities) and not 'organization.manage' = any(r.capabilities)
   and not coalesce('call_list.remove' = any(r.capabilities), false)
 group by r.organization_id, r.id, r.name order by members desc limit 200;

\echo '4. Industry templates whose roles gain view contacts'
select key, jsonb_array_length(shape->'roles') as roles
  from public.industry_templates
 where jsonb_typeof(shape->'roles') = 'array'
   and exists (select 1 from jsonb_array_elements(shape->'roles') r where not coalesce(r->'capabilities' ? 'customer.read', false));

\echo '5. Imports waiting to be applied (their rows are reviewed under the new matching once staged again)'
select status, count(*) from public.import_runs where status in ('pending', 'running') group by status;

rollback;
