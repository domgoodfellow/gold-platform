-- Rules a business writes: when this happens, if that is true, then do this.
--
-- `docs/starting_conversation.txt` describes automations (§11) and workflows (§13) as two
-- features; they are one seen twice -- a trigger, a condition and an action. What exists today
-- is the graph without the verbs: `work_item_transitions` says which status *may* follow which,
-- and nothing anywhere expresses *if* or *then*.
--
-- **The vocabulary is platform; the rules are tenant.** Which triggers, comparisons and actions
-- exist is a checked array in exactly the shape `roles_capabilities_known` uses -- adding one is
-- a migration, deliberately, because each names an operation this code actually performs. Which
-- rules exist, what they are called and what they say is a business's own data. Nothing here is
-- seeded and no business starts with a rule.
--
-- **Three deliberate limits, each of which is a decision rather than a stage of completion:**
--
--   * **One trigger kind ships here, `event`.** A schedule fires at a time and an external
--     reading fires on a number crossing a line; both need something asking *what is due*, which
--     is `apps/api`'s and lands with it. A value in this check with no code behind it would be a
--     rule a business could write and nothing could run.
--   * **An automation cannot trigger an automation.** The trigger below returns immediately when
--     it is already inside one. Chaining is a feature; a cycle is an outage, and the difference
--     between them is not decidable from the rows. A business that wants two things done writes
--     two actions on one rule.
--   * **Every condition must hold.** There is no `or`, and there is no nesting. Two conditions
--     joined by `or` are two rules, which a business can already write, and which stay readable
--     when there are nine of them.

-- ---------------------------------------------------------------------------
-- The capability
-- ---------------------------------------------------------------------------

-- Writing a rule is not editing a job and not configuring a form: it is deciding what this
-- business does without anybody present, which is plainly its own authority. Reading one needs
-- no capability -- an operator who cannot write rules still has to be able to see why a job
-- moved on its own.
alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create',
    'work_item.transition',
    'work_item.schedule',
    'work_item.record',
    'organization.manage',
    'price.manage',
    'work_item.price',
    'work_item.update',
    'invoice.issue',
    'payment.record',
    'automation.manage'
  ]::text[]);

-- Backfilled onto whoever already decides how this business is set up. `organization.manage` is
-- the closest existing answer to "decides what this business does", and a founder holds it.
update public.roles
   set capabilities = capabilities || array['automation.manage']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('automation.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- The actor with no person behind it
-- ---------------------------------------------------------------------------

-- I11 says consequential writes are attributable, and `events.actor_id` is
-- `not null references auth.users`. An automation has nobody behind it -- the person whose
-- action tripped it did not decide anything, and attributing a status change to a customer who
-- merely booked would be a lie on the timeline.
--
-- **The same answer D26 gave the payment webhook**: a real `auth.users` row that can never sign
-- in, rather than a second shape for the invariant. Only `id` is required on that table, so it
-- costs one insert. The rule that acted is named in the payload beside it.
insert into auth.users (id, instance_id, aud, role)
values (
  '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
)
on conflict (id) do nothing;

comment on schema app is
  'Internals only policies and triggers call. Nothing here is reachable from PostgREST.';

-- ---------------------------------------------------------------------------
-- automation_rules
-- ---------------------------------------------------------------------------

create table public.automation_rules (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- The business's own word for what this rule is for. Rendered as written, never translated.
  name            text        not null check (length(btrim(name)) between 1 and 120),

  -- Platform vocabulary. One value today; each later one arrives with the code that runs it.
  trigger_kind    text        not null check (trigger_kind in ('event')),

  -- Which event. Null for every trigger kind that is not `event`, which is why the pair is
  -- checked for completeness below rather than the column being made `not null` -- the same
  -- shape `work_item_types_bookable_is_complete` uses, and for the same reason: a flag beside a
  -- value is a second answer that can contradict the first.
  trigger_event_action text
    check (
      trigger_event_action is null
      or trigger_event_action in (
        'work_item.created',
        'work_item.booked',
        'work_item.status_changed',
        'work_item.scheduled',
        'work_item.unscheduled',
        'work_item.updated'
      )
    ),

  -- **Off is a column here, not a deleted row**, which is the opposite of `organization_modules`
  -- and deliberately so. A module has no history; a rule does, and a business switching one off
  -- to see what happens must be able to switch it back on without rewriting its conditions.
  enabled         boolean     not null default true,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint automation_rules_trigger_is_complete
    check (
      (trigger_kind = 'event' and trigger_event_action is not null)
      or (trigger_kind <> 'event' and trigger_event_action is null)
    )
);

comment on table public.automation_rules is
  'When this happens, if that is true, then do this. Per tenant; the platform seeds none and knows none by name.';

-- I2: the tenant leads. Two businesses both calling a rule "Confirm the booking" is ordinary.
create unique index automation_rules_org_name_unique
  on public.automation_rules (organization_id, lower(name));

-- The "which rules fire on this event" query, which runs once per event row inserted anywhere.
create index automation_rules_org_trigger_idx
  on public.automation_rules (organization_id, trigger_kind, trigger_event_action)
  where enabled;

-- The target of the composite references below (I18).
alter table public.automation_rules
  add constraint automation_rules_org_id_unique unique (organization_id, id);

-- ---------------------------------------------------------------------------
-- automation_conditions
-- ---------------------------------------------------------------------------

create table public.automation_conditions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  rule_id         uuid        not null,

  -- Which part of the subject to look at. A core column by name, or `custom.<key>` for one of
  -- this tenant's own fields -- which makes `field_definitions` the condition vocabulary for
  -- free, with no second registry to keep in step.
  subject_field   text        not null
    check (
      subject_field in (
        'title', 'status_id', 'type_id', 'customer_id', 'resource_id', 'location_id', 'asset_id'
      )
      or subject_field ~ '^custom\.[a-z][a-z0-9_]{0,62}$'
    ),

  operator        text        not null
    check (operator in ('equals', 'not_equals', 'is_set', 'is_empty')),

  -- Null for the operators that ask about presence rather than about a value.
  value           text,

  position        integer     not null default 0,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint automation_conditions_value_matches_operator
    check (
      (operator in ('is_set', 'is_empty') and value is null)
      or (operator in ('equals', 'not_equals') and value is not null)
    ),

  -- I18: a condition can only ever belong to a rule in its own tenant, because no other row can
  -- be written down.
  constraint automation_conditions_rule_same_org
    foreign key (organization_id, rule_id)
    references public.automation_rules (organization_id, id) on delete cascade
);

create index automation_conditions_org_rule_idx
  on public.automation_conditions (organization_id, rule_id, position);

-- ---------------------------------------------------------------------------
-- automation_actions
-- ---------------------------------------------------------------------------

create table public.automation_actions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  rule_id         uuid        not null,

  -- One action kind ships here, and it is the one that needs no new machinery: moving a job to
  -- a status this business has already said it may move to. Every later kind arrives with the
  -- slice that can perform it.
  action_kind     text        not null check (action_kind in ('change_status')),

  -- Which status. Null for every action kind that does not move a job.
  status_id       uuid,

  position        integer     not null default 0,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint automation_actions_status_matches_kind
    check (
      (action_kind = 'change_status' and status_id is not null)
      or (action_kind <> 'change_status' and status_id is null)
    ),

  constraint automation_actions_rule_same_org
    foreign key (organization_id, rule_id)
    references public.automation_rules (organization_id, id) on delete cascade,

  -- I18 again, on the other reference. A rule cannot name another tenant's status.
  constraint automation_actions_status_same_org
    foreign key (organization_id, status_id)
    references public.work_item_statuses (organization_id, id)
);

create index automation_actions_org_rule_idx
  on public.automation_actions (organization_id, rule_id, position);

-- ---------------------------------------------------------------------------
-- automation_runs
-- ---------------------------------------------------------------------------

-- **The failed-thing table `roadmap.md` M5 deferred to this milestone, arriving with its
-- writer.** That deferral was right: a failure in this system was a `DomainError` raised,
-- rendered to whoever caused it, and dropped, and a table with no writer is the speculative
-- abstraction `constraints.md` opens by refusing. An automation is the first thing this platform
-- does that can fail with nobody watching.
create table public.automation_runs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- **No foreign key to `automation_rules`, and none may be added.** This is the same absence
  -- `work_item_priced_lines` holds against `price_book_items`, for the same reason (I8): a run
  -- is a record of what happened, and a key would make somebody write the join that makes
  -- yesterday's history report today's rule. The name beside it is snapshotted at the moment it
  -- ran, so a renamed or deleted rule leaves the record readable and unchanged.
  rule_id         uuid        not null,
  rule_name       text        not null,
  trigger_kind    text        not null,

  -- What it acted on. Polymorphic like `events`, and carrying the same hazard: a reader
  -- filtering on `subject_id` alone will miss a run whose subject is of another type.
  subject_type    text        not null,
  subject_id      uuid        not null,

  -- **Only two outcomes, because a rule that did not match writes nothing.** A row per rule per
  -- event would bury the failures this table exists to surface. What is recorded is what
  -- happened, not what was considered.
  outcome         text        not null check (outcome in ('done', 'failed')),

  -- The database's own words on a failure, kept verbatim. An automation refused by
  -- `app.check_status_transition` says so here, which is the most useful sentence available:
  -- the business wrote a rule that moves a job somewhere its own lifecycle forbids.
  detail          text,

  occurred_at     timestamptz not null default now(),

  constraint automation_runs_detail_matches_outcome
    check ((outcome = 'failed' and detail is not null) or outcome = 'done')
);

comment on table public.automation_runs is
  'What an automation did, and what it failed to do. Snapshots its rule; holds no key to it (I8).';

create index automation_runs_org_occurred_at_idx
  on public.automation_runs (organization_id, occurred_at desc);

-- The console's query in slice eight, and a tenant's own "what went wrong" today.
create index automation_runs_org_failed_idx
  on public.automation_runs (organization_id, occurred_at desc)
  where outcome = 'failed';

-- ---------------------------------------------------------------------------
-- RLS (I1)
-- ---------------------------------------------------------------------------

alter table public.automation_rules      enable row level security;
alter table public.automation_conditions enable row level security;
alter table public.automation_actions    enable row level security;
alter table public.automation_runs       enable row level security;

alter table public.automation_rules      force row level security;
alter table public.automation_conditions force row level security;
alter table public.automation_actions    force row level security;
alter table public.automation_runs       force row level security;

-- Reading needs membership and no capability. A dispatcher who cannot write rules still has to
-- be able to find out why a job moved by itself, and hiding that would make the platform look
-- like it acts at random.
create policy automation_rules_select on public.automation_rules
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy automation_conditions_select on public.automation_conditions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy automation_actions_select on public.automation_actions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy automation_runs_select on public.automation_runs
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy automation_rules_insert on public.automation_rules
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'automation.manage')
  );

create policy automation_rules_update on public.automation_rules
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'automation.manage')
  )
  with check (organization_id in (select app.current_tenant_ids()));

create policy automation_rules_delete on public.automation_rules
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'automation.manage')
  );

create policy automation_conditions_insert on public.automation_conditions
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'automation.manage')
  );

create policy automation_conditions_delete on public.automation_conditions
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'automation.manage')
  );

create policy automation_actions_insert on public.automation_actions
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'automation.manage')
  );

create policy automation_actions_delete on public.automation_actions
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'automation.manage')
  );

-- **No write policy on `automation_runs` and no write grant.** It is written by one
-- `security definer` function and by nothing else, which is stricter than `events` -- a member
-- can append to the timeline, and nobody can append to this. A history of what the platform did
-- that the platform's users can edit would be worth nothing.
--
-- Editing a condition or an action is a delete and an insert rather than an update, for the
-- reason `organization_modules` gives: there is no update policy, so there is no path by which
-- half of one becomes another.
grant select, insert, update, delete on public.automation_rules to authenticated;
grant select, insert, delete on public.automation_conditions to authenticated;
grant select, insert, delete on public.automation_actions to authenticated;
grant select on public.automation_runs to authenticated;

-- Only the columns a business can change its mind about. Not `trigger_kind`, not
-- `trigger_event_action`: changing what a rule fires on turns it into a different rule while
-- keeping the record of what the old one did -- the same reasoning that refuses a field
-- definition's `kind` and `key`.
revoke update on public.automation_rules from authenticated;
grant update (name, enabled) on public.automation_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Who is acting
-- ---------------------------------------------------------------------------

-- Which rule, if any, this transaction is currently running on behalf of.
--
-- **Set only by `app.run_automation`, and unreachable from any client.** PostgREST issues no
-- `SET`, and no function exposed to `authenticated` sets it, so an ordinary caller cannot claim
-- to be an automation. It is local to the transaction, so it cannot outlive the run.
create function app.acting_automation()
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select nullif(current_setting('app.automation_rule_id', true), '')::uuid;
$fn$;

revoke all on function app.acting_automation() from public;
grant execute on function app.acting_automation() to authenticated;

-- **The per-column capability guard learns about a third kind of writer.**
--
-- It already exempts one: `pg_trigger_depth() > 1`, because a foreign key's `on delete set null`
-- reaches this trigger looking exactly like somebody editing a job. An automation is the second
-- case and needs saying explicitly rather than inheriting that exemption by accident -- the
-- scheduler in a later slice calls `app.run_automation` directly, at depth zero, and would
-- otherwise be refused for holding no capability in a business it is not a member of.
--
-- **What authorizes the write is the rule, and the rule was authorized when it was written**, by
-- somebody holding `automation.manage` in this tenant. That is the same argument
-- `create_booking` makes for a stranger who holds insert permission on nothing: the business
-- decided in advance, and the function performs what was decided.
create or replace function app.check_work_item_update_capability()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if app.acting_automation() is not null then
    return new;
  end if;

  if new.status_id is distinct from old.status_id
     and not app.has_capability(new.organization_id, 'work_item.transition') then
    raise exception 'you may not move work item % between statuses', new.id
      using errcode = '42501';
  end if;

  if (new.resource_id is distinct from old.resource_id
      or new.scheduled_during is distinct from old.scheduled_during)
     and not app.has_capability(new.organization_id, 'work_item.schedule') then
    raise exception 'you may not schedule work item %', new.id
      using errcode = '42501';
  end if;

  if (new.title is distinct from old.title
      or new.customer_id is distinct from old.customer_id
      or new.location_id is distinct from old.location_id
      or new.asset_id is distinct from old.asset_id
      or new.custom is distinct from old.custom)
     and not app.has_capability(new.organization_id, 'work_item.update') then
    raise exception 'you may not edit the details of work item %', new.id
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Does this rule apply
-- ---------------------------------------------------------------------------

-- Every condition must hold. There is no `or` and no nesting -- see the header.
--
-- A field this tenant has since removed from its registry reads as empty rather than raising:
-- `custom` is a jsonb object and `->>` on a missing key is null. That is the correct answer to
-- "is this set", and it means deleting a field definition cannot break a rule into an error.
create function app.automation_conditions_hold(p_rule_id uuid, p_item public.work_items)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_condition public.automation_conditions;
  v_actual    text;
begin
  for v_condition in
    select * from public.automation_conditions
     where rule_id = p_rule_id
     order by position, created_at
  loop
    v_actual := case v_condition.subject_field
      when 'title'       then p_item.title
      when 'status_id'   then p_item.status_id::text
      when 'type_id'     then p_item.type_id::text
      when 'customer_id' then p_item.customer_id::text
      when 'resource_id' then p_item.resource_id::text
      when 'location_id' then p_item.location_id::text
      when 'asset_id'    then p_item.asset_id::text
      else p_item.custom ->> substring(v_condition.subject_field from 8)
    end;

    -- An empty string and a null are the same answer to "has this been filled in", and a form
    -- submits whichever it feels like. Treating them differently would make a rule behave
    -- differently depending on which screen wrote the row.
    if v_condition.operator = 'is_set' and coalesce(btrim(v_actual), '') = '' then
      return false;
    elsif v_condition.operator = 'is_empty' and coalesce(btrim(v_actual), '') <> '' then
      return false;
    elsif v_condition.operator = 'equals' and coalesce(v_actual, '') is distinct from v_condition.value then
      return false;
    elsif v_condition.operator = 'not_equals' and coalesce(v_actual, '') is not distinct from v_condition.value then
      return false;
    end if;
  end loop;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Running one
-- ---------------------------------------------------------------------------

-- **`security definer`, so nothing below is restrained by RLS -- and every scope is therefore
-- written out rather than assumed**, which is the same discipline `create_booking` states and
-- for the same reason. The caller may be a member, or an external actor bound to one tenant who
-- holds insert permission on no table at all, or in a later slice a scheduler that is a member
-- of nothing. None of them decides anything here: the rule does.
--
-- It raises rather than swallowing. The caller records the failure, because the caller is the
-- one that knows whether it is inside somebody else's transaction.
create function app.run_automation(
  p_rule_id      uuid,
  p_subject_type text,
  p_subject_id   uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_rule   public.automation_rules;
  v_action public.automation_actions;
  v_item   public.work_items;
  v_acted  boolean := false;
begin
  select * into v_rule from public.automation_rules where id = p_rule_id;
  if v_rule.id is null or not v_rule.enabled then
    return false;
  end if;

  -- Every action this migration ships acts on a work item. A rule triggered by an event about
  -- something else has nothing to act on and is not a failure -- it simply does not apply.
  if p_subject_type <> 'work_item' then
    return false;
  end if;

  select * into v_item
    from public.work_items
   where id = p_subject_id
     and organization_id = v_rule.organization_id;

  if v_item.id is null then
    return false;
  end if;

  if not app.automation_conditions_hold(v_rule.id, v_item) then
    return false;
  end if;

  -- From here on this transaction is acting as the rule. Local, so it cannot outlive the
  -- statement that set it, and read by `app.check_work_item_update_capability` above.
  perform set_config('app.automation_rule_id', v_rule.id::text, true);

  for v_action in
    select * from public.automation_actions
     where rule_id = v_rule.id
     order by position, created_at
  loop
    if v_action.action_kind = 'change_status' then
      -- Already there. Not a failure and not worth a row: a rule that keeps a job in the status
      -- it is in has done its job the first time.
      if v_item.status_id is distinct from v_action.status_id then
        -- **`app.check_status_transition` still fires, and that is the point** (I13). A business
        -- whose rule moves a job somewhere its own lifecycle forbids gets a refusal, which the
        -- caller records as a failed run with the database's own sentence in it. An automation
        -- may not do what a person may not do.
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
          -- The rule's name is snapshotted here for the same reason it is on the run: the
          -- timeline has to stay readable after somebody renames the rule (I8).
          jsonb_build_object(
            'status_id', v_action.status_id,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      end if;
    end if;
  end loop;

  perform set_config('app.automation_rule_id', '', true);

  return v_acted;
end;
$fn$;

revoke all on function app.run_automation(uuid, text, uuid) from public;

-- ---------------------------------------------------------------------------
-- What fires it
-- ---------------------------------------------------------------------------

-- **The rules run inside the transaction that tripped them, each in its own subtransaction.**
--
-- Two things had to be true at once: a business must see the effect immediately -- a
-- confirmation that arrives on the next scheduled sweep is a confirmation nobody trusts -- and a
-- rule a business wrote badly must never roll back the write that tripped it. A customer's
-- booking failing because the business mistyped a status would be the worst failure this
-- platform could have.
--
-- plpgsql's `exception` block is a savepoint, so a failing action rolls back its own work and
-- nothing else, and the run is recorded as failed with the database's own message. That is the
-- whole of why the outcome is a row rather than a log line: this is the first thing here that
-- fails with nobody watching.
create function app.fire_event_automations()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_rule public.automation_rules;
begin
  -- An automation may not trigger an automation. The event this trigger is looking at was
  -- written by a rule, and following it would make a cycle indistinguishable from a feature.
  if app.acting_automation() is not null then
    return null;
  end if;

  -- **The module switch, enforced in the database rather than in the navigation.** A business
  -- that has not switched automations on has none, whatever rows it left behind -- the same
  -- shape `20260829000010` gave public booking, and the reason turning a module off is a real
  -- act rather than a change of menu.
  if not exists (
    select 1 from public.organization_modules m
     where m.organization_id = new.organization_id
       and m.module_key = 'automations'
  ) then
    return null;
  end if;

  for v_rule in
    select * from public.automation_rules r
     where r.organization_id = new.organization_id
       and r.enabled
       and r.trigger_kind = 'event'
       and r.trigger_event_action = new.action
     order by r.created_at
  loop
    begin
      if app.run_automation(v_rule.id, new.entity_type, new.entity_id) then
        insert into public.automation_runs
          (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome)
        values
          (new.organization_id, v_rule.id, v_rule.name, 'event', new.entity_type, new.entity_id,
           'done');
      end if;
    exception when others then
      -- The savepoint has already rolled back whatever the action half-did. The setting it may
      -- have left behind goes with it, so the next rule in this loop starts clean.
      insert into public.automation_runs
        (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome,
         detail)
      values
        (new.organization_id, v_rule.id, v_rule.name, 'event', new.entity_type, new.entity_id,
         'failed', sqlerrm);
    end;
  end loop;

  return null;
end;
$fn$;

comment on function app.fire_event_automations() is
  'Runs this tenant''s event-triggered rules, each in its own subtransaction so a bad rule cannot roll back the write that tripped it.';

create trigger events_fire_automations
  after insert on public.events
  for each row execute function app.fire_event_automations();
