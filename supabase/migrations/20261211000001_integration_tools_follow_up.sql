-- Closing the gaps in connected-tool execution.
--
-- 1. **One authorization, asked twice.** What decides whether a grant may run now is a single function,
--    `app.integration_execution_blocker`. A request calls it when it is made and again when a person
--    approves it, so withdrawing a resource, a role or a grant while a request waits stops it.
--
-- 2. **A grant is the agent's right, and the person asking must have the right too.** A native capability
--    is allowed only if the member asking the agent holds the permission that already says they work in
--    that area (`integration_capability_permissions`). Both must hold; a missing row denies. An MCP tool
--    has no such mapping, because what it does is unknown; a person approves each use instead.
--
-- 3. **An approved request can reach the conversation that asked.** When a request is made inside a
--    conversation, its result is held (bounded, for that member only, at most a day) until the
--    conversation's next turn takes it, and is deleted when taken.
--
-- 4. **An automation can run a granted tool.** A new action kind queues the call; the tick runs it through
--    the same executor, under the automation's own grant. The scheduler's role gains nothing: the queue is
--    claimed and finished through the integration runtime's doors.
--
-- 5. **The public catalogue has a stable order**, so it can be read in pages.

-- ---------------------------------------------------------------------------
-- 2. Which permission a native capability needs from the person asking
-- ---------------------------------------------------------------------------

create table public.integration_capability_permissions (
  capability_key      text primary key check (length(capability_key) between 1 and 80),
  required_permission text not null check (length(required_permission) between 1 and 60)
);

comment on table public.integration_capability_permissions is
  'The permission a member needs, besides the agent holding a grant, for the agent to use a native capability on their behalf. Platform-owned. A capability with no row is refused.';

alter table public.integration_capability_permissions enable row level security;
alter table public.integration_capability_permissions force row level security;
revoke all on public.integration_capability_permissions from anon, authenticated;
create policy integration_capability_permissions_select on public.integration_capability_permissions
  for select to authenticated using (true);
grant select on public.integration_capability_permissions to authenticated;

-- The nearest permission that already says "this member works with this kind of data":
-- customers, the diary, documents and files, messaging, and the business's own technical setup.
insert into public.integration_capability_permissions (capability_key, required_permission) values
  ('crm.contacts.list',            'customer.update'),
  ('crm.companies.list',           'customer.update'),
  ('crm.deals.list',               'customer.update'),
  ('crm.pipelines.list',           'customer.update'),
  ('calendar.events.list',         'work_item.schedule'),
  ('drive.files.list',             'document.create'),
  ('sheets.values.get',            'document.create'),
  ('onedrive.files.list',          'document.create'),
  ('excel.range.get',              'document.create'),
  ('notion.search',                'document.create'),
  ('notion.database.query',        'document.create'),
  ('notion.page.get',              'document.create'),
  ('dropbox.files.list',           'document.create'),
  ('dropbox.files.metadata',       'document.create'),
  ('slack.channels.list',          'message.send'),
  ('slack.messages.history',       'message.send'),
  ('cloudflare.zones.list',        'organization.manage'),
  ('cloudflare.dns.records.list',  'organization.manage'),
  ('github.repositories.list',     'organization.manage'),
  ('github.issues.list',           'organization.manage'),
  ('github.commits.list',          'organization.manage');

-- ---------------------------------------------------------------------------
-- What the execution record needs to carry
-- ---------------------------------------------------------------------------

alter table public.integration_executions
  add column resource_value  text check (resource_value is null or length(resource_value) <= 300),
  add column conversation_id uuid,
  add column result_payload  jsonb check (result_payload is null or pg_column_size(result_payload) <= 40000),
  add column delivered_at    timestamptz;

comment on column public.integration_executions.result_payload is
  'The bounded result of an approved request, held only so the conversation that asked can take it once. Cleared on delivery and after a day. Never readable by a signed-in role directly.';

-- A result is the one column a signed-in role may not read, whoever manages integrations.
revoke select on public.integration_executions from authenticated;
grant select (
  id, organization_id, principal_kind, principal_id, invoked_by, grant_id, target_kind, connection_id,
  connector_key, mcp_server_id, mcp_tool_id, capability_key, tool_name, decision, refusal_reason,
  approval_state, approved_by, approved_at, status, error_class, arguments_hash, pending_arguments,
  result_bytes, requested_at, expires_at, started_at, completed_at, duration_ms, correlation_id,
  resource_value, conversation_id, delivered_at
) on public.integration_executions to authenticated;

-- ---------------------------------------------------------------------------
-- 1 + 2. The single blocker
-- ---------------------------------------------------------------------------

-- `null` means nothing blocks it. Everything about *whether this principal may run this grant now*
-- lives here; what differs between a new request and an approval is only which arguments are in hand.
create function app.integration_execution_blocker(
  p_organization_id uuid,
  p_principal_kind  text,
  p_principal_id    uuid,
  p_grant_id        uuid,
  p_resource_value  text,
  p_invoked_by      uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  t          record;
  v_required text;
begin
  select * into t from app.integration_grant_target(p_organization_id, p_grant_id);

  -- Comparisons against a null principal column are null, not false, so the match is a definite answer.
  if not found
     or not coalesce((p_principal_kind = 'assistant' and t.assistant_id = p_principal_id)
                  or (p_principal_kind = 'automation' and t.automation_rule_id = p_principal_id), false) then
    return 'not_granted';
  end if;

  if t.blocked_reason is not null then
    return t.blocked_reason;
  end if;

  if p_principal_kind = 'assistant' and not exists (
       select 1 from public.ai_assistants a
        where a.organization_id = p_organization_id and a.id = p_principal_id and a.status = 'active') then
    return 'principal_inactive';
  end if;
  if p_principal_kind = 'automation' and not exists (
       select 1 from public.automation_rules r
        where r.organization_id = p_organization_id and r.id = p_principal_id and r.enabled) then
    return 'principal_inactive';
  end if;

  if t.resource_id is not null and p_resource_value is distinct from t.resource_external_id then
    return 'resource_not_granted';
  end if;
  -- Connected is not permitted: the assistant's own reading gate still applies to a resource.
  if t.resource_id is not null and p_principal_kind = 'assistant'
     and not coalesce((select public.assistant_may_read_resource(p_organization_id, t.resource_id)), false) then
    return 'resource_not_readable_by_assistant';
  end if;

  -- The person asking must hold the permission for the kind of data this reads. An automation has no
  -- asking member; an MCP tool has no mapping and is held by approval instead.
  if p_principal_kind = 'assistant' and t.target_kind = 'native' then
    select required_permission into v_required
      from public.integration_capability_permissions where capability_key = t.capability_key;
    if v_required is null then
      return 'permission_unmapped';
    end if;
    if p_invoked_by is null or not exists (
         select 1
           from public.memberships m
           join public.roles r on r.id = m.role_id
          where m.user_id = p_invoked_by and m.organization_id = p_organization_id
            and v_required = any (r.capabilities)) then
      return 'actor_not_permitted';
    end if;
  end if;

  return null;
end;
$fn$;

revoke all on function app.integration_execution_blocker(uuid, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The decision, recorded: now with the blocker, the resource value and a conversation
-- ---------------------------------------------------------------------------

drop function app.authorize_integration_execution(uuid, text, uuid, uuid, jsonb, text, uuid, text);

create function app.authorize_integration_execution(
  p_organization_id uuid,
  p_principal_kind  text,
  p_principal_id    uuid,
  p_grant_id        uuid,
  p_arguments       jsonb,
  p_resource_value  text,
  p_invoked_by      uuid,
  p_correlation     text,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  t          record;
  v_args     jsonb := coalesce(p_arguments, '{}'::jsonb);
  v_hash     text;
  v_reason   text;
  v_found    boolean;
  v_decision text;
  v_status   text;
  v_id       uuid := gen_random_uuid();
begin
  v_hash := encode(sha256(convert_to(v_args::text, 'UTF8')), 'hex');

  select * into t from app.integration_grant_target(p_organization_id, p_grant_id);
  v_found := found;

  v_reason := app.integration_execution_blocker(
    p_organization_id, p_principal_kind, p_principal_id, p_grant_id, p_resource_value, p_invoked_by);

  if v_reason is null then
    if jsonb_typeof(v_args) <> 'object' then
      v_reason := 'invalid_arguments';
    elsif pg_column_size(v_args) > 16384 then
      v_reason := 'arguments_too_large';
    elsif t.requires_approval and (select count(*) from public.integration_executions e
          where e.organization_id = p_organization_id and e.status = 'pending_approval') >= 50 then
      v_reason := 'too_many_pending';
    end if;
  end if;

  if v_reason is not null then
    v_decision := 'refused'; v_status := 'refused';
  elsif t.requires_approval then
    v_decision := 'approval_required'; v_status := 'pending_approval';
  else
    v_decision := 'allowed'; v_status := 'running';
  end if;

  insert into public.integration_executions (
    id, organization_id, principal_kind, principal_id, invoked_by, grant_id,
    target_kind, connection_id, connector_key, mcp_server_id, mcp_tool_id, capability_key, tool_name,
    decision, refusal_reason, approval_state, status, arguments_hash, pending_arguments,
    resource_value, conversation_id, expires_at, started_at, correlation_id
  ) values (
    v_id, p_organization_id, p_principal_kind, p_principal_id, p_invoked_by,
    case when v_found then t.grant_id end,
    case when v_found and v_reason is null then t.target_kind end,
    case when v_found and v_reason is null then t.connection_id end,
    case when v_found and v_reason is null then t.connector_key end,
    case when v_found and v_reason is null then t.mcp_server_id end,
    case when v_found and v_reason is null then t.mcp_tool_id end,
    case when v_found and v_reason is null then t.capability_key end,
    case when v_found and v_reason is null then t.mcp_tool_name end,
    v_decision, v_reason,
    case v_decision when 'approval_required' then 'pending' else 'not_required' end,
    v_status, v_hash,
    case when v_decision = 'approval_required' then v_args end,
    case when v_reason is null then left(p_resource_value, 300) end,
    p_conversation_id,
    case when v_decision = 'approval_required' then now() + interval '24 hours' end,
    case when v_decision = 'allowed' then now() end,
    left(p_correlation, 120)
  );

  if v_reason is not null then
    return jsonb_build_object('execution_id', v_id, 'decision', 'refused', 'reason', v_reason);
  end if;

  return jsonb_build_object(
    'execution_id', v_id, 'decision', v_decision, 'reason', null,
    'target_kind', t.target_kind, 'connection_id', t.connection_id, 'connector_key', t.connector_key,
    'capability_key', t.capability_key, 'mcp_endpoint', t.mcp_endpoint, 'mcp_tool_name', t.mcp_tool_name,
    'resource_type', t.resource_type
  );
end;
$fn$;

revoke all on function app.authorize_integration_execution(uuid, text, uuid, uuid, jsonb, text, uuid, text, uuid) from public, anon, authenticated;

drop function public.authorize_assistant_tool_call(uuid, uuid, uuid, jsonb, text, text);

create function public.authorize_assistant_tool_call(
  p_organization_id uuid,
  p_assistant_id    uuid,
  p_grant_id        uuid,
  p_arguments       jsonb,
  p_resource_value  text default null,
  p_correlation     text default null,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_conversation uuid;
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'assistant.ask') then
    raise exception 'Agent access denied.' using errcode = '42501';
  end if;
  if not exists (
       select 1
         from public.ai_assistants a
         join public.ai_assistant_deployments d on d.organization_id = a.organization_id and d.assistant_id = a.id
        where a.organization_id = p_organization_id and a.id = p_assistant_id
          and a.status = 'active' and d.surface = 'operator_copilot' and d.enabled) then
    raise exception 'Agent access denied.' using errcode = '42501';
  end if;

  -- A conversation is named only if it is this member's own, in this business; anything else is ignored.
  select c.id into v_conversation
    from public.agent_conversations c
   where c.organization_id = p_organization_id and c.id = p_conversation_id and c.created_by = (select auth.uid());

  return app.authorize_integration_execution(
    p_organization_id, 'assistant', p_assistant_id, p_grant_id, p_arguments, p_resource_value,
    (select auth.uid()), p_correlation, v_conversation);
end;
$fn$;

revoke all on function public.authorize_assistant_tool_call(uuid, uuid, uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.authorize_assistant_tool_call(uuid, uuid, uuid, jsonb, text, text, uuid) to authenticated;

create or replace function public.authorize_automation_tool_call(
  p_rule_id        uuid,
  p_grant_id       uuid,
  p_arguments      jsonb,
  p_resource_value text default null,
  p_correlation    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.automation_rules where id = p_rule_id;
  if not found then
    raise exception 'No such automation.' using errcode = '22023';
  end if;
  return app.authorize_integration_execution(
    v_org, 'automation', p_rule_id, p_grant_id, p_arguments, p_resource_value, null, p_correlation, null);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Approval repeats the whole authorization
-- ---------------------------------------------------------------------------

create or replace function public.decide_integration_execution(p_execution_id uuid, p_approve boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  e        record;
  t        record;
  v_reason text;
begin
  select * into e from public.integration_executions where id = p_execution_id for update;
  if not found
     or (select auth.uid()) is null
     or e.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(e.organization_id, 'integration.manage') then
    raise exception 'No such request.' using errcode = '42501';
  end if;
  if e.status <> 'pending_approval' then
    raise exception 'That request has already been decided.' using errcode = '22023';
  end if;

  if e.expires_at is not null and e.expires_at < now() then
    update public.integration_executions
       set status = 'expired', approval_state = 'expired', pending_arguments = null, completed_at = now()
     where id = e.id;
    return jsonb_build_object('decision', 'expired');
  end if;

  if not p_approve then
    update public.integration_executions
       set status = 'rejected', approval_state = 'rejected', approved_by = (select auth.uid()),
           approved_at = now(), pending_arguments = null, completed_at = now()
     where id = e.id;
    return jsonb_build_object('decision', 'rejected');
  end if;

  -- Approving is not a bypass of anything: the same policy a new request meets, with the same
  -- resource value and the same person asking, as it stands at this moment.
  v_reason := app.integration_execution_blocker(
    e.organization_id, e.principal_kind, e.principal_id, e.grant_id, e.resource_value, e.invoked_by);
  if v_reason is not null then
    update public.integration_executions
       set status = 'refused', decision = 'refused', refusal_reason = v_reason, approval_state = 'rejected',
           pending_arguments = null, completed_at = now()
     where id = e.id;
    return jsonb_build_object('decision', 'refused', 'reason', v_reason);
  end if;

  select * into t from app.integration_grant_target(e.organization_id, e.grant_id);

  update public.integration_executions
     set status = 'running', approval_state = 'approved', approved_by = (select auth.uid()),
         approved_at = now(), started_at = now()
   where id = e.id;

  return jsonb_build_object(
    'decision', 'approved', 'execution_id', e.id, 'organization_id', e.organization_id,
    'target_kind', t.target_kind, 'connection_id', t.connection_id, 'connector_key', t.connector_key,
    'capability_key', t.capability_key, 'mcp_endpoint', t.mcp_endpoint, 'mcp_tool_name', t.mcp_tool_name,
    'arguments', coalesce(e.pending_arguments, '{}'::jsonb));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The result of an approved request reaches the conversation that asked
-- ---------------------------------------------------------------------------

drop function public.complete_integration_execution(uuid, boolean, text, integer);

create function public.complete_integration_execution(
  p_execution_id uuid, p_succeeded boolean, p_error_class text default null, p_result_bytes integer default null,
  p_result jsonb default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  update public.integration_executions
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         error_class = case when p_succeeded then null else coalesce(p_error_class, 'internal') end,
         result_bytes = p_result_bytes,
         -- Held only for a request a person approved inside a conversation, so that conversation can take it.
         result_payload = case when p_succeeded and conversation_id is not null and approval_state = 'approved'
                                    and p_result is not null and pg_column_size(p_result) <= 40000
                               then p_result end,
         pending_arguments = null,
         completed_at = now(),
         duration_ms = greatest(0, (extract(epoch from (now() - coalesce(started_at, requested_at))) * 1000)::integer)
   where id = p_execution_id and status = 'running';
  if not found then
    raise exception 'No such running execution.' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.complete_integration_execution(uuid, boolean, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.complete_integration_execution(uuid, boolean, text, integer, jsonb) to integration_operator;

-- What has been decided since this member last asked in this conversation, once. Taking it deletes the
-- stored result. Only the member who asked, in their own conversation, ever sees it.
create function public.take_integration_results(p_organization_id uuid, p_conversation_id uuid)
returns table (execution_id uuid, tool_label text, status text, error_class text, result jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'assistant.ask') then
    raise exception 'Agent access denied.' using errcode = '42501';
  end if;

  return query
    with taken as (
      update public.integration_executions e
         set delivered_at = now(), result_payload = null
       where e.id in (
               select x.id from public.integration_executions x
                where x.organization_id = p_organization_id
                  and x.conversation_id = p_conversation_id
                  and x.invoked_by = (select auth.uid())
                  and x.delivered_at is null
                  and x.status in ('succeeded', 'failed', 'rejected', 'expired')
                  and x.approval_state in ('approved', 'rejected', 'expired')
                order by x.requested_at
                limit 10
                for update skip locked)
      returning e.id, coalesce(e.tool_name, e.capability_key, 'a tool') as label, e.status, e.error_class,
                (select x.result_payload from public.integration_executions x where x.id = e.id) as payload_before
    )
    select t.id, t.label, t.status, t.error_class, t.payload_before from taken t;
end;
$fn$;

revoke all on function public.take_integration_results(uuid, uuid) from public, anon;
grant execute on function public.take_integration_results(uuid, uuid) to authenticated;

-- Retention: undelivered results go after a day, and the queue below gives up on what it cannot finish.
create or replace function public.purge_integration_executions(p_older_than interval default interval '90 days')
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_deleted integer;
begin
  update public.integration_executions
     set status = 'failed', error_class = 'internal', pending_arguments = null, completed_at = now()
   where status = 'running' and coalesce(started_at, requested_at) < now() - interval '15 minutes';

  update public.integration_executions
     set status = 'expired', approval_state = 'expired', pending_arguments = null, completed_at = now()
   where status = 'pending_approval' and expires_at < now();

  update public.integration_executions
     set result_payload = null
   where result_payload is not null and completed_at < now() - interval '24 hours';

  update public.integration_action_queue
     set state = 'failed', detail = 'Gave up after repeated attempts.', finished_at = now()
   where state = 'claimed' and attempts >= 3 and claimed_at < now() - interval '1 hour';

  delete from public.integration_action_queue
   where state in ('done', 'failed') and finished_at < now() - p_older_than;

  delete from public.integration_executions
   where status in ('refused', 'succeeded', 'failed', 'rejected', 'expired') and requested_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. An automation can run a granted tool
-- ---------------------------------------------------------------------------

alter table public.automation_actions
  add column grant_id       uuid,
  add column tool_arguments jsonb check (tool_arguments is null or (jsonb_typeof(tool_arguments) = 'object' and pg_column_size(tool_arguments) <= 4096)),
  add column tool_label     text  check (tool_label is null or length(tool_label) <= 160);

-- The grant belongs to this rule's own automation; deleting it removes the action that depended on it.
alter table public.automation_actions
  add constraint automation_actions_grant_same_org
  foreign key (organization_id, grant_id)
  references public.integration_tool_grants (organization_id, id) on delete cascade;

alter table public.automation_actions drop constraint automation_actions_action_kind_check;
alter table public.automation_actions
  add constraint automation_actions_action_kind_check
  check (action_kind in ('change_status', 'notify', 'shift_schedule', 'create_work_item', 'run_tool'));

alter table public.automation_actions drop constraint automation_actions_config_matches_kind;
alter table public.automation_actions
  add constraint automation_actions_config_matches_kind
  check (
    case action_kind
      when 'change_status' then
        status_id is not null and template_id is null and channel is null
        and shift_minutes is null and work_item_type_id is null
        and grant_id is null and tool_arguments is null
      when 'notify' then
        status_id is null and template_id is not null and channel is not null
        and shift_minutes is null and work_item_type_id is null
        and grant_id is null and tool_arguments is null
      when 'shift_schedule' then
        status_id is null and template_id is null and channel is null
        and shift_minutes is not null and shift_minutes <> 0 and work_item_type_id is null
        and grant_id is null and tool_arguments is null
      when 'create_work_item' then
        template_id is null and channel is null and shift_minutes is null
        and work_item_type_id is not null and status_id is not null
        and grant_id is null and tool_arguments is null
      when 'run_tool' then
        status_id is null and template_id is null and channel is null
        and shift_minutes is null and work_item_type_id is null
        and grant_id is not null and tool_arguments is not null
      else false
    end
  );

-- The three new columns are written only by `add_automation_tool_action` below: a signed-in role can
-- read them but cannot point an action at a grant by an ordinary insert or update.
-- The table grants insert as a whole, so it is withdrawn and given back by column, without the three.
revoke insert on public.automation_actions from authenticated;
grant insert (id, organization_id, rule_id, action_kind, status_id, position, created_at, created_by,
              template_id, channel, shift_minutes, work_item_type_id)
  on public.automation_actions to authenticated;
revoke update (grant_id, tool_arguments, tool_label) on public.automation_actions from authenticated;

create table public.integration_action_queue (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  rule_id         uuid        not null,
  action_id       uuid        not null,
  grant_id        uuid        not null,
  subject_type    text        not null,
  subject_id      uuid        not null,
  arguments       jsonb       not null,
  state           text        not null default 'queued' check (state in ('queued', 'claimed', 'done', 'failed')),
  attempts        integer     not null default 0,
  queued_at       timestamptz not null default now(),
  claimed_at      timestamptz,
  finished_at     timestamptz,
  detail          text        check (detail is null or length(detail) <= 300),
  -- A rule that fires twice for one subject asks once, as a message does.
  unique (organization_id, action_id, subject_type, subject_id)
);

comment on table public.integration_action_queue is
  'Tool calls an automation has asked for, waiting for the integration runtime. Snapshots, with no keys to rows that may change (I8). Nobody signed in can read or write it.';

create index integration_action_queue_due_idx on public.integration_action_queue (queued_at) where state in ('queued', 'claimed');

alter table public.integration_action_queue enable row level security;
alter table public.integration_action_queue force row level security;
revoke all on public.integration_action_queue from anon, authenticated;

-- Wiring a tool into a rule is one act that needs both rights: managing the automation and managing the
-- connection. It creates the automation's grant and the action that uses it together.
create function public.add_automation_tool_action(
  p_organization_id uuid,
  p_rule_id         uuid,
  p_connection_id   uuid,
  p_capability_key  text,
  p_arguments       jsonb,
  p_label           text,
  p_resource_id     uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_grant uuid;
  v_id    uuid;
begin
  if v_actor is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'automation.manage')
     or not app.has_capability(p_organization_id, 'integration.manage') then
    raise exception 'Managing automations and integrations is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.automation_rules r where r.organization_id = p_organization_id and r.id = p_rule_id) then
    raise exception 'No such rule.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_arguments, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_arguments, '{}'::jsonb)) > 4096 then
    raise exception 'The tool''s settings are not usable.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.integration_capability_permissions where capability_key = p_capability_key) then
    raise exception 'That cannot be used by an automation.' using errcode = '22023';
  end if;

  v_grant := public.grant_integration_tool(
    p_organization_id, null, p_rule_id, p_connection_id, p_capability_key, null, p_resource_id, false);

  insert into public.automation_actions (organization_id, rule_id, action_kind, grant_id, tool_arguments, tool_label, created_by)
  values (p_organization_id, p_rule_id, 'run_tool', v_grant, coalesce(p_arguments, '{}'::jsonb), left(p_label, 160), v_actor)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.add_automation_tool_action(uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.add_automation_tool_action(uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated;

-- Removing the action ends the right it used.
create function app.end_tool_grant_of_removed_action()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if old.grant_id is not null then
    update public.integration_tool_grants
       set status = 'revoked', revoked_by = (select auth.uid()), revoked_at = now()
     where organization_id = old.organization_id and id = old.grant_id and status = 'active';
  end if;
  return old;
end;
$fn$;

revoke all on function app.end_tool_grant_of_removed_action() from public, anon, authenticated;

create trigger automation_actions_end_tool_grant
  after delete on public.automation_actions
  for each row execute function app.end_tool_grant_of_removed_action();

-- The one place a rule's actions are carried out, with `run_tool` added. The rest is unchanged.
CREATE OR REPLACE FUNCTION app.run_automation(p_rule_id uuid, p_subject_type text, p_subject_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule      public.automation_rules;
  v_action    public.automation_actions;
  v_item      public.work_items;
  v_template  public.message_templates;
  v_recipient text;
  v_asset     public.assets;
  v_new       uuid;
  v_acted     boolean := false;
begin
  select * into v_rule from public.automation_rules where id = p_rule_id;
  if v_rule.id is null or not v_rule.enabled then
    return false;
  end if;

  if p_subject_type = 'work_item' then
    select * into v_item
      from public.work_items
     where id = p_subject_id and organization_id = v_rule.organization_id;
    if v_item.id is null then
      return false;
    end if;
    if not app.automation_conditions_hold(v_rule.id, v_item) then
      return false;
    end if;
  elsif p_subject_type = 'asset' then
    select * into v_asset
      from public.assets
     where id = p_subject_id and organization_id = v_rule.organization_id;
    if v_asset.id is null then
      return false;
    end if;
  else
    return false;
  end if;

  perform set_config('app.automation_rule_id', v_rule.id::text, true);

  for v_action in
    select * from public.automation_actions
     where rule_id = v_rule.id
     order by position, created_at
  loop
    if v_action.action_kind = 'create_work_item' then
      -- **The job is titled with the rule's name**, which is the business's own sentence about
      -- why this work exists â€” "Service the compressor every five hundred hours". There is
      -- deliberately no separate title field: a second place to write the same thing is a second
      -- place for it to go stale, and the platform has no title of its own to offer.
      insert into public.work_items
        (organization_id, type_id, status_id, asset_id, title, created_by)
      values (
        v_rule.organization_id,
        v_action.work_item_type_id,
        v_action.status_id,
        case when p_subject_type = 'asset' then v_asset.id else v_item.asset_id end,
        v_rule.name,
        '00000000-0000-4000-8000-0000000000a2'
      )
      returning id into v_new;

      insert into public.events
        (organization_id, actor_id, entity_type, entity_id, action, payload)
      values (
        v_rule.organization_id,
        '00000000-0000-4000-8000-0000000000a2',
        'work_item',
        v_new,
        'work_item.created',
        jsonb_build_object(
          'title', v_rule.name,
          'automation_rule_id', v_rule.id,
          'automation_rule_name', v_rule.name
        )
      );

      v_acted := true;

    elsif v_action.action_kind = 'run_tool' then
      -- **Queued here, run by the integration runtime.** A rule fires inside a write, or on the clock with
      -- nobody present; an outside call belongs in neither. Asking twice for one subject asks once.
      v_new := null;
      with ins as (
        insert into public.integration_action_queue
          (organization_id, rule_id, action_id, grant_id, subject_type, subject_id, arguments)
        values
          (v_rule.organization_id, v_rule.id, v_action.id, v_action.grant_id, p_subject_type, p_subject_id,
           v_action.tool_arguments)
        on conflict (organization_id, action_id, subject_type, subject_id) do nothing
        returning id
      )
      select id into v_new from ins;
      IF v_new IS NOT NULL then
        v_acted := true;
      end if;

    elsif p_subject_type <> 'work_item' then
      -- Every other action edits a job that already exists, and this rule is about an asset.
      -- Skipped rather than raised: a rule carrying both kinds of action is a reasonable thing
      -- for a business to write.
      continue;

    elsif v_action.action_kind = 'change_status' then
      if v_item.status_id is distinct from v_action.status_id then
        update public.work_items
           set status_id = v_action.status_id
         where id = v_item.id;

        insert into public.events
          (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          v_rule.organization_id,
          '00000000-0000-4000-8000-0000000000a2',
          'work_item',
          v_item.id,
          'work_item.status_changed',
          jsonb_build_object(
            'status_id', v_action.status_id,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      end if;

    elsif v_action.action_kind = 'shift_schedule' then
      if v_item.scheduled_during is null then
        raise exception 'this job is not in the diary, so there is nothing to move';
      end if;

      update public.work_items
         set scheduled_during = tstzrange(
               lower(v_item.scheduled_during) + make_interval(mins => v_action.shift_minutes),
               upper(v_item.scheduled_during) + make_interval(mins => v_action.shift_minutes),
               '[)'
             )
       where id = v_item.id;

      insert into public.events
        (organization_id, actor_id, entity_type, entity_id, action, payload)
      values (
        v_rule.organization_id,
        '00000000-0000-4000-8000-0000000000a2',
        'work_item',
        v_item.id,
        'work_item.scheduled',
        jsonb_build_object(
          'shift_minutes', v_action.shift_minutes,
          'automation_rule_id', v_rule.id,
          'automation_rule_name', v_rule.name
        )
      );

      select * into v_item from public.work_items where id = v_item.id;
      v_acted := true;

    elsif v_action.action_kind = 'notify' then
      select * into v_template
        from public.message_templates where id = v_action.template_id;

      if v_template.id is null then
        raise exception 'the template this rule writes from is no longer here';
      end if;

      if v_action.channel = 'email' then
        select nullif(btrim(c.email), '') into v_recipient
          from public.customers c where c.id = v_item.customer_id;
      else
        select nullif(btrim(c.phone), '') into v_recipient
          from public.customers c where c.id = v_item.customer_id;
      end if;

      if v_recipient is null then
        raise exception
          'this job has nobody to write to; add a condition so the rule only runs when it does';
      end if;

      begin
        insert into public.message_deliveries
          (organization_id, rule_id, rule_name, subject_type, subject_id, channel, recipient,
           subject_line, body)
        values (
          v_rule.organization_id, v_rule.id, v_rule.name, 'work_item', v_item.id,
          v_action.channel, v_recipient,
          app.resolve_message_template(v_template.subject, v_item),
          app.resolve_message_template(v_template.body, v_item)
        );

        insert into public.events
          (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          v_rule.organization_id,
          '00000000-0000-4000-8000-0000000000a2',
          'work_item',
          v_item.id,
          'work_item.message_queued',
          jsonb_build_object(
            'channel', v_action.channel,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      exception when unique_violation then
        null;
      end;
    end if;
  end loop;

  perform set_config('app.automation_rule_id', '', true);

  return v_acted;
end;
$function$;


-- The integration runtime claims what is queued and says how it ended. A claim that is never finished
-- is taken again after ten minutes, up to three attempts.
create function public.claim_integration_actions(p_limit integer default 20)
returns table (id uuid, rule_id uuid, grant_id uuid, arguments jsonb, attempts integer)
language sql
volatile
security definer
set search_path = ''
as $fn$
  update public.integration_action_queue q
     set state = 'claimed', claimed_at = now(), attempts = q.attempts + 1
   where q.id in (
           select x.id from public.integration_action_queue x
            where (x.state = 'queued' or (x.state = 'claimed' and x.claimed_at < now() - interval '10 minutes'))
              and x.attempts < 3
            order by x.queued_at
            limit least(greatest(coalesce(p_limit, 20), 1), 50)
            for update skip locked)
  returning q.id, q.rule_id, q.grant_id, q.arguments, q.attempts;
$fn$;

revoke all on function public.claim_integration_actions(integer) from public, anon, authenticated;
grant execute on function public.claim_integration_actions(integer) to integration_operator;

-- `p_outcome` is `done` or `failed`. A failure the runtime thinks worth another try goes back in the
-- queue (while attempts remain) and writes nothing; every final outcome is one row of the rule's history.
create function public.finish_integration_action(
  p_id uuid, p_outcome text, p_detail text default null, p_retry boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  q      record;
  v_name text;
begin
  if p_outcome not in ('done', 'failed') then
    raise exception 'Unknown outcome.' using errcode = '22023';
  end if;

  select * into q from public.integration_action_queue where id = p_id and state = 'claimed' for update;
  if not found then
    raise exception 'No such claimed action.' using errcode = '22023';
  end if;

  if p_outcome = 'failed' and p_retry and q.attempts < 3 then
    update public.integration_action_queue
       set state = 'queued', claimed_at = null, detail = left(p_detail, 300)
     where id = p_id;
    return;
  end if;

  update public.integration_action_queue
     set state = p_outcome, finished_at = now(), detail = left(p_detail, 300)
   where id = p_id;

  select name into v_name from public.automation_rules where id = q.rule_id and organization_id = q.organization_id;

  insert into public.automation_runs
    (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome, detail)
  values (
    q.organization_id, q.rule_id, coalesce(v_name, 'A removed rule'), 'tool', q.subject_type, q.subject_id, p_outcome,
    case when p_outcome = 'failed' then coalesce(nullif(left(p_detail, 300), ''), 'The connected tool failed.') end
  );
end;
$fn$;

revoke all on function public.finish_integration_action(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_integration_action(uuid, text, text, boolean) to integration_operator;

-- ---------------------------------------------------------------------------
-- 5. A stable order for the public catalogue, so it can be read in pages
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.public_plan_catalog()
 RETURNS TABLE(plan_key text, kind text, label text, description text, requires_contact_sales boolean, prices jsonb, products jsonb, quotas jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    p.key,
    p.kind,
    p.label,
    p.description,
    not exists (
      select 1 from public.platform_plan_prices pr
       where pr.plan_id = p.id and pr.approval_state = 'approved'
    ) as requires_contact_sales,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'currency', pr.currency,
               'amountMinor', pr.amount_minor,
               'billingInterval', pr.billing_interval
             ) order by pr.currency, pr.billing_interval)
        from public.platform_plan_prices pr
       where pr.plan_id = p.id and pr.approval_state = 'approved'
    ), '[]'::jsonb) as prices,
    coalesce((
      select jsonb_agg(jsonb_build_object('key', cp.key, 'label', cp.label) order by cp.display_order)
        from public.platform_plan_product_grants g
        join public.platform_catalog_products cp on cp.id = g.product_id
       where g.plan_id = p.id
    ), '[]'::jsonb) as products,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'allowanceKey', q.allowance_key,
               'label', q.label,
               'unit', q.unit,
               'includedQuantity', q.included_quantity,
               'period', q.period,
               'overagePolicy', q.overage_policy
             ) order by q.display_order)
        from public.platform_plan_quotas q
       where q.plan_id = p.id
    ), '[]'::jsonb) as quotas
  from public.platform_plans p
  where p.sale_status = 'active'
    and p.billable = true
  order by p.kind, p.display_order, p.key;
$function$;

