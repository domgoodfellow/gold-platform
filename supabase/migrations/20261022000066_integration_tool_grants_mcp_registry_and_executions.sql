-- Making an integration usable and governable: MCP servers and their tools, who may execute what,
-- and what happened when they did.
--
-- **Five questions, five places, never one table.**
--   * Is the outside system connected?        integration_connections (exists; an MCP server IS one,
--                                              so its bearer secret lives in the same Vault path).
--   * What does the server advertise?          integration_mcp_servers, integration_mcp_tools.
--   * May the organization offer it at all?    integration_mcp_tools.enabled, after a human review.
--   * May THIS principal run it?               integration_tool_grants (an assistant or an automation).
--   * What happened?                           integration_executions.
--
-- **Discovered is not enabled is not granted.** A tool that appears in a server's listing starts
-- unreviewed and disabled. A tool whose name, description or schema later changes is a different
-- tool: it returns to unreviewed and disabled, so a server cannot widen what it does under a
-- grant that was given for something else.
--
-- **An MCP tool always needs a human's approval in this slice.** A server's `readOnlyHint` is its
-- own claim, and nothing the platform can enforce independently says a remote tool is read-only, so
-- the reviewer's classification is recorded but never removes the approval step. The table
-- refuses an MCP grant that does not require approval.
--
-- **Identity is never an argument.** A grant names one principal and one target. The runtime asks
-- "may this principal run this grant" and the answer comes from rows, not from anything a model or
-- a caller typed. The organization is proved from the caller's own membership (assistants) or from
-- the automation rule's own row (automations).
--
-- **The execution log keeps facts, not content.** Arguments are held only while an approval is
-- pending and are cleared when the request is decided or finished; results are never stored, only
-- their size. History is a snapshot (no foreign keys to rows that may later change, I8).

-- ---------------------------------------------------------------------------
-- The MCP connector: a server is one kind of connection
-- ---------------------------------------------------------------------------

insert into public.platform_connectors
  (key, name, description, category, status, auth_method, connection_method, is_public, display_order, capabilities)
values
  ('mcp_server', 'MCP server',
   'A remote Model Context Protocol server. Its tools are reviewed, enabled and granted one by one.',
   'Developer', 'beta', 'api_key', 'mcp', true, 900, array['app_connections', 'agent_tools'])
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Servers and tools
-- ---------------------------------------------------------------------------

create table public.integration_mcp_servers (
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references public.organizations (id) on delete cascade,
  connection_id         uuid        not null,
  name                  text        not null check (length(btrim(name)) between 1 and 120),
  -- Written only by the runtime that proved the address is a public https one (apps/api).
  endpoint              text        not null check (endpoint ~ '^https://[^/@ ]+' and length(endpoint) <= 2000),
  enabled               boolean     not null default true,
  protocol_version      text        check (protocol_version is null or length(protocol_version) <= 40),
  server_name           text        check (server_name is null or length(server_name) <= 200),
  discovery_status      text        not null default 'never' check (discovery_status in ('never', 'succeeded', 'failed')),
  last_discovered_at    timestamptz,
  last_discovery_error  text        check (last_discovery_error is null or length(last_discovery_error) <= 500),
  created_by            uuid        not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (organization_id, id),
  unique (organization_id, connection_id),
  foreign key (organization_id, connection_id)
    references public.integration_connections (organization_id, id) on delete cascade
);

comment on table public.integration_mcp_servers is
  'A business''s MCP server. Its credential is the connection''s, in Vault; nothing secret is stored here. enabled is the business''s switch; discovery_status is what the last discovery said.';

create table public.integration_mcp_tools (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null,
  server_id        uuid        not null,
  -- The server's own stable name for the tool, unique only within its server.
  name             text        not null check (length(name) between 1 and 128),
  -- Untrusted text from a third party. Stored for a person to read; never an instruction.
  description      text        not null default '' check (length(description) <= 2000),
  input_schema     jsonb       not null default '{}'::jsonb check (jsonb_typeof(input_schema) = 'object' and pg_column_size(input_schema) <= 32768),
  -- The server's claim. Shown, never relied on.
  read_only_hint   boolean,
  -- Changes whenever name, description or schema do.
  schema_hash      text        not null,
  -- The organization's own review. 'unreviewed' until a person with integration.manage decides.
  classification   text        not null default 'unreviewed' check (classification in ('unreviewed', 'read', 'write')),
  enabled          boolean     not null default false,
  status           text        not null default 'available' check (status in ('available', 'removed')),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  reviewed_by      uuid        references auth.users (id),
  reviewed_at      timestamptz,

  unique (organization_id, id),
  unique (organization_id, server_id, name),
  foreign key (organization_id, server_id)
    references public.integration_mcp_servers (organization_id, id) on delete cascade,
  -- Offering a tool requires that someone decided what it is, and that the server still lists it.
  constraint integration_mcp_tools_enabled_is_reviewed
    check (not enabled or (classification <> 'unreviewed' and status = 'available'))
);

comment on table public.integration_mcp_tools is
  'A tool a server advertises. Starts unreviewed and disabled; a change to its name, description or schema returns it there. Enabled means the business may grant it, not that anyone may run it.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

create table public.integration_tool_grants (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references public.organizations (id) on delete cascade,

  -- Exactly one principal: an existing assistant, or an existing automation rule.
  assistant_id         uuid,
  automation_rule_id   uuid,

  target_kind          text        not null check (target_kind in ('native', 'mcp')),
  connection_id        uuid,
  capability_key       text        check (capability_key is null or length(capability_key) between 1 and 80),
  mcp_tool_id          uuid,
  -- Optional narrowing of a native capability to one discovered resource.
  resource_id          uuid,

  requires_approval    boolean     not null default false,
  status               text        not null default 'active' check (status in ('active', 'revoked')),

  granted_by           uuid        not null references auth.users (id),
  granted_at           timestamptz not null default now(),
  revoked_by           uuid        references auth.users (id),
  revoked_at           timestamptz,

  unique (organization_id, id),
  constraint integration_tool_grants_one_principal
    check (num_nonnulls(assistant_id, automation_rule_id) = 1),
  constraint integration_tool_grants_target_is_complete
    check (
      (target_kind = 'native' and connection_id is not null and capability_key is not null and mcp_tool_id is null)
      or (target_kind = 'mcp' and mcp_tool_id is not null and connection_id is null and capability_key is null and resource_id is null)
    ),
  constraint integration_tool_grants_mcp_needs_approval
    check (target_kind <> 'mcp' or requires_approval),
  constraint integration_tool_grants_revocation_is_complete
    check ((status = 'revoked') = (revoked_at is not null)),

  foreign key (organization_id, assistant_id)       references public.ai_assistants (organization_id, id) on delete cascade,
  foreign key (organization_id, automation_rule_id) references public.automation_rules (organization_id, id) on delete cascade,
  foreign key (organization_id, connection_id)      references public.integration_connections (organization_id, id) on delete cascade,
  foreign key (organization_id, mcp_tool_id)        references public.integration_mcp_tools (organization_id, id) on delete cascade,
  foreign key (organization_id, resource_id)        references public.integration_resources (organization_id, id) on delete cascade
);

comment on table public.integration_tool_grants is
  'Who may run what. One principal, one target, optionally one resource. A connection or an enabled tool grants nothing by itself; revoking is a status change so history stays readable.';

-- One live grant per principal and target (a null is not a value, so it is coalesced).
create unique index integration_tool_grants_one_active
  on public.integration_tool_grants (
    organization_id,
    coalesce(assistant_id, automation_rule_id),
    target_kind,
    coalesce(connection_id, mcp_tool_id),
    coalesce(capability_key, ''),
    coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

create index integration_tool_grants_assistant_idx
  on public.integration_tool_grants (organization_id, assistant_id) where status = 'active' and assistant_id is not null;
create index integration_tool_grants_rule_idx
  on public.integration_tool_grants (organization_id, automation_rule_id) where status = 'active' and automation_rule_id is not null;

-- ---------------------------------------------------------------------------
-- Executions
-- ---------------------------------------------------------------------------

create table public.integration_executions (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations (id) on delete cascade,

  principal_kind    text        not null check (principal_kind in ('assistant', 'automation')),
  principal_id      uuid        not null,
  -- The person whose session an assistant ran under. Null for an automation.
  invoked_by        uuid,

  -- Snapshots, deliberately without foreign keys (I8): the record outlives the rows it names.
  grant_id          uuid,
  target_kind       text        check (target_kind is null or target_kind in ('native', 'mcp')),
  connection_id     uuid,
  connector_key     text,
  mcp_server_id     uuid,
  mcp_tool_id       uuid,
  capability_key    text,
  tool_name         text,

  decision          text        not null check (decision in ('allowed', 'refused', 'approval_required')),
  refusal_reason    text        check (refusal_reason is null or length(refusal_reason) <= 60),
  approval_state    text        not null default 'not_required'
                                  check (approval_state in ('not_required', 'pending', 'approved', 'rejected', 'expired')),
  approved_by       uuid,
  approved_at       timestamptz,

  status            text        not null
                                  check (status in ('refused', 'pending_approval', 'running', 'succeeded', 'failed', 'rejected', 'expired')),
  error_class       text        check (error_class is null or error_class in
                                  ('provider_refused', 'unreachable', 'invalid_input', 'credential_unavailable', 'timeout', 'tool_error', 'unsupported', 'internal')),

  arguments_hash    text,
  -- Held only while a decision is pending or the run is in flight; cleared after.
  pending_arguments jsonb,
  result_bytes      integer     check (result_bytes is null or result_bytes >= 0),

  requested_at      timestamptz not null default now(),
  expires_at        timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  duration_ms       integer     check (duration_ms is null or duration_ms >= 0),
  correlation_id    text        check (correlation_id is null or length(correlation_id) <= 120),

  unique (organization_id, id)
);

comment on table public.integration_executions is
  'One authorized or refused invocation. Facts only: who, which target, the decision and its reason, the outcome and its duration. Arguments live here only while an approval is pending or the call is running; results are never stored.';

create index integration_executions_org_requested_idx
  on public.integration_executions (organization_id, requested_at desc);
create index integration_executions_pending_idx
  on public.integration_executions (organization_id, requested_at) where status = 'pending_approval';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.integration_mcp_servers  enable row level security;
alter table public.integration_mcp_tools    enable row level security;
alter table public.integration_tool_grants  enable row level security;
alter table public.integration_executions   enable row level security;
alter table public.integration_mcp_servers  force row level security;
alter table public.integration_mcp_tools    force row level security;
alter table public.integration_tool_grants  force row level security;
alter table public.integration_executions   force row level security;

revoke all on public.integration_mcp_servers, public.integration_mcp_tools,
              public.integration_tool_grants, public.integration_executions from anon, authenticated;

-- Reading is for the people who manage integrations. Every write goes through a function below,
-- so no policy grants one.
create policy integration_mcp_servers_select on public.integration_mcp_servers
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'));
create policy integration_mcp_tools_select on public.integration_mcp_tools
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'));
create policy integration_tool_grants_select on public.integration_tool_grants
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'));
create policy integration_executions_select on public.integration_executions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'integration.manage'));

grant select on public.integration_mcp_servers, public.integration_mcp_tools,
                public.integration_tool_grants, public.integration_executions to authenticated;

-- ---------------------------------------------------------------------------
-- What a grant currently points at, and whether that is live
-- ---------------------------------------------------------------------------

create function app.integration_grant_target(p_organization_id uuid, p_grant_id uuid)
returns table (
  grant_id uuid, assistant_id uuid, automation_rule_id uuid, target_kind text,
  connection_id uuid, connector_key text, capability_key text,
  mcp_server_id uuid, mcp_tool_id uuid, mcp_tool_name text, mcp_endpoint text,
  requires_approval boolean, resource_id uuid, resource_type text, resource_external_id text,
  blocked_reason text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select g.id, g.assistant_id, g.automation_rule_id, g.target_kind,
         coalesce(g.connection_id, s.connection_id), c.connector_key, g.capability_key,
         s.id, t.id, t.name, s.endpoint,
         g.requires_approval, r.id, r.resource_type, r.external_id,
         case
           when g.status <> 'active' then 'grant_revoked'
           when c.id is null or c.status <> 'active' then 'connection_inactive'
           when g.target_kind = 'mcp' and (s.id is null or not s.enabled) then 'server_disabled'
           when g.target_kind = 'mcp' and (t.status <> 'available') then 'tool_removed'
           when g.target_kind = 'mcp' and (not t.enabled or t.classification = 'unreviewed') then 'tool_not_enabled'
           when g.resource_id is not null and (r.id is null or r.status <> 'active') then 'resource_unavailable'
           else null
         end
    from public.integration_tool_grants g
    left join public.integration_mcp_tools t on t.organization_id = g.organization_id and t.id = g.mcp_tool_id
    left join public.integration_mcp_servers s on s.organization_id = t.organization_id and s.id = t.server_id
    left join public.integration_connections c
           on c.organization_id = g.organization_id and c.id = coalesce(g.connection_id, s.connection_id)
    left join public.integration_resources r on r.organization_id = g.organization_id and r.id = g.resource_id
   where g.organization_id = p_organization_id and g.id = p_grant_id;
$fn$;

revoke all on function app.integration_grant_target(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one authorization decision, recorded
-- ---------------------------------------------------------------------------

create function app.authorize_integration_execution(
  p_organization_id uuid,
  p_principal_kind  text,
  p_principal_id    uuid,
  p_grant_id        uuid,
  p_arguments       jsonb,
  p_resource_value  text,
  p_invoked_by      uuid,
  p_correlation     text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  t         record;
  v_args    jsonb := coalesce(p_arguments, '{}'::jsonb);
  v_hash    text;
  v_reason  text;
  v_found   boolean;
  v_decision text;
  v_status  text;
  v_id      uuid := gen_random_uuid();
begin
  v_hash := encode(sha256(convert_to(v_args::text, 'UTF8')), 'hex');

  select * into t from app.integration_grant_target(p_organization_id, p_grant_id);
  v_found := found;

  -- Comparisons against a null principal column are null, not false, so the match is spelled out as
  -- a definite answer: a grant held by an assistant is never an automation's, and the reverse.
  if not v_found
     or not coalesce((p_principal_kind = 'assistant' and t.assistant_id = p_principal_id)
                  or (p_principal_kind = 'automation' and t.automation_rule_id = p_principal_id), false) then
    v_reason := 'not_granted';
  elsif t.blocked_reason is not null then
    v_reason := t.blocked_reason;
  elsif jsonb_typeof(v_args) <> 'object' then
    v_reason := 'invalid_arguments';
  elsif pg_column_size(v_args) > 16384 then
    v_reason := 'arguments_too_large';
  elsif p_principal_kind = 'assistant' and not exists (
          select 1 from public.ai_assistants a
           where a.organization_id = p_organization_id and a.id = p_principal_id and a.status = 'active') then
    v_reason := 'principal_inactive';
  elsif p_principal_kind = 'automation' and not exists (
          select 1 from public.automation_rules r
           where r.organization_id = p_organization_id and r.id = p_principal_id and r.enabled) then
    v_reason := 'principal_inactive';
  elsif t.resource_id is not null and p_resource_value is distinct from t.resource_external_id then
    v_reason := 'resource_not_granted';
  elsif t.resource_id is not null and p_principal_kind = 'assistant'
        and not coalesce((select public.assistant_may_read_resource(p_organization_id, t.resource_id)), false) then
    -- Connected is not permitted: the assistant's own reading gate still applies to a resource.
    v_reason := 'resource_not_readable_by_assistant';
  elsif (select count(*) from public.integration_executions e
          where e.organization_id = p_organization_id and e.status = 'pending_approval') >= 50
        and t.requires_approval then
    v_reason := 'too_many_pending';
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
    expires_at, started_at, correlation_id
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

revoke all on function app.authorize_integration_execution(uuid, text, uuid, uuid, jsonb, text, uuid, text) from public, anon, authenticated;

-- An operator's assistant, running under that operator's own session. The organization is proved
-- by the caller's membership, never accepted: naming a business the caller is not in is refused
-- before anything is recorded against it.
create function public.authorize_assistant_tool_call(
  p_organization_id uuid,
  p_assistant_id    uuid,
  p_grant_id        uuid,
  p_arguments       jsonb,
  p_resource_value  text default null,
  p_correlation     text default null
)
returns jsonb
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
  if not exists (
       select 1
         from public.ai_assistants a
         join public.ai_assistant_deployments d on d.organization_id = a.organization_id and d.assistant_id = a.id
        where a.organization_id = p_organization_id and a.id = p_assistant_id
          and a.status = 'active' and d.surface = 'operator_copilot' and d.enabled) then
    raise exception 'Agent access denied.' using errcode = '42501';
  end if;

  return app.authorize_integration_execution(
    p_organization_id, 'assistant', p_assistant_id, p_grant_id, p_arguments, p_resource_value,
    (select auth.uid()), p_correlation);
end;
$fn$;

revoke all on function public.authorize_assistant_tool_call(uuid, uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.authorize_assistant_tool_call(uuid, uuid, uuid, jsonb, text, text) to authenticated;

-- An automation. The organization comes from the rule's own row, never from the caller. The door belongs
-- to the integration runtime (`integration_operator`), which is what executes a tool: the scheduler's own
-- role (`automation_runner`) holds a deliberately small set of functions and gains none here.
create function public.authorize_automation_tool_call(
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
    v_org, 'automation', p_rule_id, p_grant_id, p_arguments, p_resource_value, null, p_correlation);
end;
$fn$;

revoke all on function public.authorize_automation_tool_call(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.authorize_automation_tool_call(uuid, uuid, jsonb, text, text) to integration_operator;

-- ---------------------------------------------------------------------------
-- What a principal can currently see: only live grants
-- ---------------------------------------------------------------------------

create function app.live_granted_tools(p_organization_id uuid, p_principal_kind text, p_principal_id uuid)
returns table (
  grant_id uuid, target_kind text, connection_id uuid, connector_key text, capability_key text,
  mcp_tool_name text, mcp_description text, mcp_input_schema jsonb,
  requires_approval boolean, resource_id uuid, resource_type text, resource_external_id text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select x.grant_id, x.target_kind, x.connection_id, x.connector_key, x.capability_key,
         x.mcp_tool_name, t.description, t.input_schema,
         x.requires_approval, x.resource_id, x.resource_type, x.resource_external_id
    from public.integration_tool_grants g
    cross join lateral app.integration_grant_target(g.organization_id, g.id) x
    left join public.integration_mcp_tools t on t.organization_id = g.organization_id and t.id = x.mcp_tool_id
   where g.organization_id = p_organization_id
     and g.status = 'active'
     and ((p_principal_kind = 'assistant' and g.assistant_id = p_principal_id)
       or (p_principal_kind = 'automation' and g.automation_rule_id = p_principal_id))
     and x.blocked_reason is null
   order by g.granted_at
   limit 100;
$fn$;

revoke all on function app.live_granted_tools(uuid, text, uuid) from public, anon, authenticated;

create function public.granted_tools_for_assistant(p_organization_id uuid, p_assistant_id uuid)
returns table (
  grant_id uuid, target_kind text, connection_id uuid, connector_key text, capability_key text,
  mcp_tool_name text, mcp_description text, mcp_input_schema jsonb,
  requires_approval boolean, resource_id uuid, resource_type text, resource_external_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'assistant.ask') then
    raise exception 'Agent access denied.' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.ai_assistants a
        where a.organization_id = p_organization_id and a.id = p_assistant_id and a.status = 'active') then
    return;
  end if;
  return query select * from app.live_granted_tools(p_organization_id, 'assistant', p_assistant_id);
end;
$fn$;

revoke all on function public.granted_tools_for_assistant(uuid, uuid) from public, anon;
grant execute on function public.granted_tools_for_assistant(uuid, uuid) to authenticated;

create function public.granted_tools_for_automation(p_rule_id uuid)
returns table (
  grant_id uuid, target_kind text, connection_id uuid, connector_key text, capability_key text,
  mcp_tool_name text, mcp_description text, mcp_input_schema jsonb,
  requires_approval boolean, resource_id uuid, resource_type text, resource_external_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.automation_rules where id = p_rule_id and enabled;
  if not found then
    return;
  end if;
  return query select * from app.live_granted_tools(v_org, 'automation', p_rule_id);
end;
$fn$;

revoke all on function public.granted_tools_for_automation(uuid) from public, anon, authenticated;
grant execute on function public.granted_tools_for_automation(uuid) to integration_operator;

-- ---------------------------------------------------------------------------
-- Granting and revoking: for people who manage integrations
-- ---------------------------------------------------------------------------

create function public.grant_integration_tool(
  p_organization_id    uuid,
  p_assistant_id       uuid,
  p_automation_rule_id uuid,
  p_connection_id      uuid,
  p_capability_key     text,
  p_mcp_tool_id        uuid,
  p_resource_id        uuid default null,
  p_requires_approval  boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
  v_kind  text := case when p_mcp_tool_id is not null then 'mcp' else 'native' end;
begin
  if v_actor is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'integration.manage') then
    raise exception 'Integration management permission required.' using errcode = '42501';
  end if;

  if v_kind = 'mcp' then
    if not exists (
         select 1
           from public.integration_mcp_tools t
           join public.integration_mcp_servers s on s.organization_id = t.organization_id and s.id = t.server_id
           join public.integration_connections c on c.organization_id = s.organization_id and c.id = s.connection_id
          where t.organization_id = p_organization_id and t.id = p_mcp_tool_id
            and t.enabled and t.status = 'available' and s.enabled and c.status = 'active') then
      raise exception 'That tool is not enabled.' using errcode = '22023';
    end if;
  else
    if p_connection_id is null or coalesce(p_capability_key, '') = '' then
      raise exception 'A connection and a capability are required.' using errcode = '22023';
    end if;
    if not exists (
         select 1 from public.integration_connections c
          where c.organization_id = p_organization_id and c.id = p_connection_id
            and c.status = 'active' and c.connector_key <> 'mcp_server') then
      raise exception 'That connection is not active.' using errcode = '22023';
    end if;
    if p_resource_id is not null and not exists (
         select 1 from public.integration_resources r
          where r.organization_id = p_organization_id and r.id = p_resource_id
            and r.connection_id = p_connection_id and r.status = 'active') then
      raise exception 'That resource does not belong to the connection.' using errcode = '22023';
    end if;
  end if;

  insert into public.integration_tool_grants (
    organization_id, assistant_id, automation_rule_id, target_kind, connection_id, capability_key,
    mcp_tool_id, resource_id, requires_approval, granted_by
  ) values (
    p_organization_id, p_assistant_id, p_automation_rule_id, v_kind,
    case when v_kind = 'native' then p_connection_id end,
    case when v_kind = 'native' then p_capability_key end,
    p_mcp_tool_id,
    case when v_kind = 'native' then p_resource_id end,
    (v_kind = 'mcp' or coalesce(p_requires_approval, false)),
    v_actor
  ) returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.grant_integration_tool(uuid, uuid, uuid, uuid, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.grant_integration_tool(uuid, uuid, uuid, uuid, text, uuid, uuid, boolean) to authenticated;

create function public.revoke_integration_tool_grant(p_organization_id uuid, p_grant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'integration.manage') then
    raise exception 'Integration management permission required.' using errcode = '42501';
  end if;

  update public.integration_tool_grants
     set status = 'revoked', revoked_by = (select auth.uid()), revoked_at = now()
   where organization_id = p_organization_id and id = p_grant_id and status = 'active';
  if not found then
    raise exception 'No such active grant.' using errcode = '22023';
  end if;

  -- A request still waiting for approval under this grant can no longer be approved.
  update public.integration_executions
     set status = 'rejected', approval_state = 'rejected', pending_arguments = null
   where organization_id = p_organization_id and grant_id = p_grant_id and status = 'pending_approval';
end;
$fn$;

revoke all on function public.revoke_integration_tool_grant(uuid, uuid) from public, anon;
grant execute on function public.revoke_integration_tool_grant(uuid, uuid) to authenticated;

create function public.review_mcp_tool(p_organization_id uuid, p_tool_id uuid, p_classification text, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'integration.manage') then
    raise exception 'Integration management permission required.' using errcode = '42501';
  end if;
  if p_classification not in ('unreviewed', 'read', 'write') then
    raise exception 'Unknown classification.' using errcode = '22023';
  end if;
  if p_enabled and p_classification = 'unreviewed' then
    raise exception 'Review the tool before enabling it.' using errcode = '22023';
  end if;

  update public.integration_mcp_tools
     set classification = p_classification,
         enabled = p_enabled,
         reviewed_by = case when p_classification = 'unreviewed' then null else (select auth.uid()) end,
         reviewed_at = case when p_classification = 'unreviewed' then null else now() end
   where organization_id = p_organization_id and id = p_tool_id
     and (status = 'available' or not p_enabled);
  if not found then
    raise exception 'No such tool.' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.review_mcp_tool(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.review_mcp_tool(uuid, uuid, text, boolean) to authenticated;

create function public.set_mcp_server_enabled(p_organization_id uuid, p_server_id uuid, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'integration.manage') then
    raise exception 'Integration management permission required.' using errcode = '42501';
  end if;
  update public.integration_mcp_servers
     set enabled = p_enabled, updated_at = now()
   where organization_id = p_organization_id and id = p_server_id;
  if not found then
    raise exception 'No such server.' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.set_mcp_server_enabled(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_mcp_server_enabled(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Approving or rejecting a waiting request
-- ---------------------------------------------------------------------------

-- Approval belongs to this one request: this principal, this target, these arguments. Nothing the
-- approver's browser supplies other than the request's id and a yes or a no.
create function public.decide_integration_execution(p_execution_id uuid, p_approve boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  e record;
  t record;
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

  -- Approving is not a bypass of anything else: the grant, the target and the principal must
  -- all still be live at this moment.
  select * into t from app.integration_grant_target(e.organization_id, e.grant_id);
  v_reason := case
    when not found then 'not_granted'
    when t.blocked_reason is not null then t.blocked_reason
    when e.principal_kind = 'assistant' and not exists (
         select 1 from public.ai_assistants a
          where a.organization_id = e.organization_id and a.id = e.principal_id and a.status = 'active') then 'principal_inactive'
    when e.principal_kind = 'automation' and not exists (
         select 1 from public.automation_rules r
          where r.organization_id = e.organization_id and r.id = e.principal_id and r.enabled) then 'principal_inactive'
    else null
  end;
  if v_reason is not null then
    update public.integration_executions
       set status = 'refused', decision = 'refused', refusal_reason = v_reason, approval_state = 'rejected',
           pending_arguments = null, completed_at = now()
     where id = e.id;
    return jsonb_build_object('decision', 'refused', 'reason', v_reason);
  end if;

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

revoke all on function public.decide_integration_execution(uuid, boolean) from public, anon;
grant execute on function public.decide_integration_execution(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The runtime's doors (integration_operator): outcomes, discovery, rotation, retention
-- ---------------------------------------------------------------------------

create function public.complete_integration_execution(
  p_execution_id uuid, p_succeeded boolean, p_error_class text default null, p_result_bytes integer default null
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
         pending_arguments = null,
         completed_at = now(),
         duration_ms = greatest(0, (extract(epoch from (now() - coalesce(started_at, requested_at))) * 1000)::integer)
   where id = p_execution_id and status = 'running';
  if not found then
    raise exception 'No such running execution.' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.complete_integration_execution(uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.complete_integration_execution(uuid, boolean, text, integer) to integration_operator;

create function public.upsert_mcp_server(p_organization_id uuid, p_connection_id uuid, p_name text, p_endpoint text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id   uuid;
  v_user uuid;
begin
  select connected_by into v_user from public.integration_connections
   where organization_id = p_organization_id and id = p_connection_id and connector_key = 'mcp_server';
  if not found then
    raise exception 'No such MCP connection.' using errcode = '22023';
  end if;

  insert into public.integration_mcp_servers (organization_id, connection_id, name, endpoint, created_by)
  values (p_organization_id, p_connection_id, p_name, p_endpoint, v_user)
  on conflict (organization_id, connection_id)
  do update set name = excluded.name, endpoint = excluded.endpoint, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.upsert_mcp_server(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.upsert_mcp_server(uuid, uuid, text, text) to integration_operator;

-- Reconciles what a server listed against what is stored. New tools arrive unreviewed and
-- disabled; a changed tool goes back to that; a tool the server no longer lists is marked removed
-- and disabled. Nothing here enables anything or touches a grant.
create function public.record_mcp_discovery(
  p_server_id uuid, p_ok boolean, p_error text, p_protocol_version text, p_server_name text, p_tools jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org   uuid;
  v_item  jsonb;
  v_hash  text;
  v_count integer := 0;
  v_names text[] := '{}';
begin
  select organization_id into v_org from public.integration_mcp_servers where id = p_server_id;
  if not found then
    raise exception 'No such server.' using errcode = '22023';
  end if;

  if not p_ok then
    update public.integration_mcp_servers
       set discovery_status = 'failed', last_discovery_error = left(coalesce(p_error, 'discovery failed'), 500), updated_at = now()
     where id = p_server_id;
    return 0;
  end if;

  if jsonb_typeof(coalesce(p_tools, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_tools, '[]'::jsonb)) > 500 then
    raise exception 'Too many tools.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_tools, '[]'::jsonb)) loop
    if coalesce(v_item->>'name', '') = '' or length(v_item->>'name') > 128 then
      continue;
    end if;
    v_hash := encode(sha256(convert_to(
      (v_item->>'name') || E'\n' || coalesce(v_item->>'description', '') || E'\n' || coalesce(v_item->'input_schema', '{}'::jsonb)::text,
      'UTF8')), 'hex');
    v_names := v_names || (v_item->>'name');

    insert into public.integration_mcp_tools (
      organization_id, server_id, name, description, input_schema, read_only_hint, schema_hash
    ) values (
      v_org, p_server_id, v_item->>'name', left(coalesce(v_item->>'description', ''), 2000),
      case when jsonb_typeof(v_item->'input_schema') = 'object' and pg_column_size(v_item->'input_schema') <= 32768
           then v_item->'input_schema' else '{}'::jsonb end,
      case when jsonb_typeof(v_item->'read_only_hint') = 'boolean' then (v_item->>'read_only_hint')::boolean end,
      v_hash
    )
    on conflict (organization_id, server_id, name) do update
       set description = excluded.description,
           input_schema = excluded.input_schema,
           read_only_hint = excluded.read_only_hint,
           last_seen_at = now(),
           status = 'available',
           -- A different tool is an unreviewed tool.
           classification = case when public.integration_mcp_tools.schema_hash = excluded.schema_hash
                                 then public.integration_mcp_tools.classification else 'unreviewed' end,
           enabled = case when public.integration_mcp_tools.schema_hash = excluded.schema_hash
                          then public.integration_mcp_tools.enabled else false end,
           reviewed_by = case when public.integration_mcp_tools.schema_hash = excluded.schema_hash
                              then public.integration_mcp_tools.reviewed_by end,
           reviewed_at = case when public.integration_mcp_tools.schema_hash = excluded.schema_hash
                              then public.integration_mcp_tools.reviewed_at end,
           schema_hash = excluded.schema_hash;
    v_count := v_count + 1;
  end loop;

  update public.integration_mcp_tools
     set status = 'removed', enabled = false
   where server_id = p_server_id and not (name = any (v_names)) and status <> 'removed';

  update public.integration_mcp_servers
     set discovery_status = 'succeeded', last_discovered_at = now(), last_discovery_error = null,
         protocol_version = left(p_protocol_version, 40), server_name = left(p_server_name, 200), updated_at = now()
   where id = p_server_id;
  return v_count;
end;
$fn$;

revoke all on function public.record_mcp_discovery(uuid, boolean, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_mcp_discovery(uuid, boolean, text, text, text, jsonb) to integration_operator;

-- Rotating a credential only if nobody else rotated it first. Two callers that both found a token
-- near expiry must not overwrite each other's newer pair with an older one.
create function public.swap_integration_credential(p_connection_id uuid, p_expected_refresh text, p_secret text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_secret_id uuid;
  v_current   text;
begin
  if btrim(coalesce(p_secret, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;

  select secret_id into v_secret_id from public.integration_connections where id = p_connection_id for update;
  if not found or v_secret_id is null then
    raise exception 'no such credential' using errcode = '22023';
  end if;

  select d.decrypted_secret into v_current from vault.decrypted_secrets d where d.id = v_secret_id;
  if (v_current::jsonb)->>'refresh_token' is distinct from p_expected_refresh then
    return false;
  end if;

  perform vault.update_secret(v_secret_id, p_secret);
  return true;
end;
$fn$;

revoke all on function public.swap_integration_credential(uuid, text, text) from public, anon, authenticated;
grant execute on function public.swap_integration_credential(uuid, text, text) to integration_operator;

-- Retention: terminal history older than the window is deleted; a call that never reported back is
-- failed and its arguments dropped. The scheduler that calls this is not part of this change.
create function public.purge_integration_executions(p_older_than interval default interval '90 days')
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

  delete from public.integration_executions
   where status in ('refused', 'succeeded', 'failed', 'rejected', 'expired') and requested_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

revoke all on function public.purge_integration_executions(interval) from public, anon, authenticated;
grant execute on function public.purge_integration_executions(interval) to integration_operator;
