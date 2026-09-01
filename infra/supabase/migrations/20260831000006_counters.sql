-- A counter crossing a line, which is the third trigger shape and the one that is easy to miss.
--
-- `constraints.md`, *Decided, not yet built*, warns about exactly this: "A schedule fires at a
-- time; weather fires on an external event; this fires when **an accumulated counter a human or
-- a sensor advances crosses a threshold**. A when/if/then runtime built for events does not
-- express that naturally, and discovering it after the runtime exists is more expensive than
-- reading it here." It was read here. The two shapes already built cannot express it: nothing
-- happens at a time, and nobody outside says anything — a person writes down that the compressor
-- has run four hundred hours, and the four hundredth hour is the event.
--
-- **The bookkeeping is a mark, not a schedule.** `Mechanic_Maintenance` keeps a `nextDueHours`
-- per task; this keeps the reading a rule last acted at, which is the same fact with one fewer
-- thing to maintain — a business that changes the interval changes what is due next without
-- anything needing to be recalculated.
--
-- **Conditions do not apply to this kind, and the domain layer refuses to add one.** Every
-- condition this platform has looks at a job, and a counter rule is about an asset before any
-- job exists. Silently ignoring them would be the worse answer: a business would write one and
-- believe it.

-- ---------------------------------------------------------------------------
-- asset_readings
-- ---------------------------------------------------------------------------

create table public.asset_readings (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  asset_id        uuid        not null,

  -- One number. **What it counts is the business's word** — hours, kilometres, cycles, litres —
  -- and the platform has no list of them, because a counter is a counter whatever it measures.
  value           double precision not null check (value >= 0),
  unit            text        not null check (length(btrim(unit)) between 1 and 16),

  -- When the counter read this, which is not when somebody typed it in.
  read_at         timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint asset_readings_asset_same_org
    foreign key (organization_id, asset_id)
    references public.assets (organization_id, id) on delete cascade
);

comment on table public.asset_readings is
  'An append-only log of what an asset''s counter said. A correction is a new row; nothing is edited.';

-- I2 leads it. The lookup every rule makes: this asset, most recent first.
create index asset_readings_org_asset_idx
  on public.asset_readings (organization_id, asset_id, read_at desc);

alter table public.asset_readings enable row level security;
alter table public.asset_readings force row level security;

create policy asset_readings_select on public.asset_readings
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- `asset.create`, for the reason `work_item_types_insert` reuses `field.manage`: reading a meter
-- and adding the machine it is on are the same person's job, and a capability with no operation
-- distinct from another is vocabulary nobody can act on differently.
create policy asset_readings_insert on public.asset_readings
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'asset.create')
  );

-- **Append-only: no update policy and no delete policy**, which is the same shape `events` has
-- and for the same reason. A counter that could be edited backwards is a counter that could be
-- made to trip a rule twice, or never.
grant select, insert on public.asset_readings to authenticated;

-- ---------------------------------------------------------------------------
-- A rule that fires on a counter
-- ---------------------------------------------------------------------------

alter table public.automation_rules
  drop constraint automation_rules_trigger_kind_check;

alter table public.automation_rules
  add constraint automation_rules_trigger_kind_check
  check (trigger_kind in ('event', 'schedule', 'external_reading', 'counter_threshold'));

-- How far the counter has to move. Reuses `trigger_unit`, which already exists and already means
-- the same thing: a step of 500 in hours and one in kilometres are different rules, and nothing
-- anywhere converts between them.
alter table public.automation_rules
  add column trigger_counter_step double precision
    check (trigger_counter_step is null or trigger_counter_step > 0);

alter table public.automation_rules
  drop constraint automation_rules_trigger_is_complete;

alter table public.automation_rules
  add constraint automation_rules_trigger_is_complete
  check (
    case trigger_kind
      when 'event' then
        trigger_event_action is not null and trigger_offset_minutes is null
        and trigger_metric is null and trigger_counter_step is null
      when 'schedule' then
        trigger_offset_minutes is not null and trigger_event_action is null
        and trigger_metric is null and trigger_counter_step is null
      when 'external_reading' then
        trigger_event_action is null and trigger_offset_minutes is null
        and trigger_counter_step is null
        and trigger_metric is not null and trigger_comparison is not null
        and trigger_threshold is not null and trigger_unit is not null
      when 'counter_threshold' then
        trigger_event_action is null and trigger_offset_minutes is null
        and trigger_metric is null and trigger_comparison is null
        and trigger_threshold is null
        and trigger_counter_step is not null and trigger_unit is not null
      else false
    end
  );

revoke update on public.automation_rules from authenticated;
grant update (name, enabled) on public.automation_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Where a counter rule got to
-- ---------------------------------------------------------------------------

-- **One row per rule per asset, holding the reading it last acted at.** Not a due date and not a
-- next-due figure: those are derived from this and the step, so a business that changes the
-- interval changes what is due next without anything needing recalculating.
--
-- The first reading a rule sees sets the mark without acting. That is the honest answer to
-- "switch this on for a machine that has already run nine hundred hours" — the alternative is a
-- rule that immediately raises nine jobs for services that were done years ago.
create table public.automation_counter_marks (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  rule_id         uuid        not null,
  asset_id        uuid        not null,
  last_value      double precision not null,
  updated_at      timestamptz not null default now(),

  primary key (organization_id, rule_id, asset_id),

  constraint automation_counter_marks_rule_same_org
    foreign key (organization_id, rule_id)
    references public.automation_rules (organization_id, id) on delete cascade,
  constraint automation_counter_marks_asset_same_org
    foreign key (organization_id, asset_id)
    references public.assets (organization_id, id) on delete cascade
);

alter table public.automation_counter_marks enable row level security;
alter table public.automation_counter_marks force row level security;

create policy automation_counter_marks_select on public.automation_counter_marks
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Read-only from outside. Written by the runtime and by nothing else, like `automation_runs`.
grant select on public.automation_counter_marks to authenticated;

-- ---------------------------------------------------------------------------
-- Raising the work
-- ---------------------------------------------------------------------------

alter table public.automation_actions
  add column work_item_type_id uuid;

alter table public.automation_actions
  add constraint automation_actions_type_same_org
  foreign key (organization_id, work_item_type_id)
  references public.work_item_types (organization_id, id);

-- I20's shape: the status must belong to *this type*, not merely to this tenant. Skipped
-- automatically for every other action kind, because a composite key with a null column is not
-- checked — which is exactly right here, since `change_status` names a status and no type.
alter table public.automation_actions
  add constraint automation_actions_new_status_same_type
  foreign key (organization_id, work_item_type_id, status_id)
  references public.work_item_statuses (organization_id, type_id, id);

alter table public.automation_actions
  drop constraint automation_actions_action_kind_check;

alter table public.automation_actions
  add constraint automation_actions_action_kind_check
  check (action_kind in ('change_status', 'notify', 'shift_schedule', 'create_work_item'));

alter table public.automation_actions
  drop constraint automation_actions_config_matches_kind;

alter table public.automation_actions
  add constraint automation_actions_config_matches_kind
  check (
    case action_kind
      when 'change_status' then
        status_id is not null and template_id is null and channel is null
        and shift_minutes is null and work_item_type_id is null
      when 'notify' then
        status_id is null and template_id is not null and channel is not null
        and shift_minutes is null and work_item_type_id is null
      when 'shift_schedule' then
        status_id is null and template_id is null and channel is null
        and shift_minutes is not null and shift_minutes <> 0 and work_item_type_id is null
      when 'create_work_item' then
        template_id is null and channel is null and shift_minutes is null
        and work_item_type_id is not null and status_id is not null
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- Two subjects now, and the runtime knows the difference
-- ---------------------------------------------------------------------------

-- **A rule about an asset and a rule about a job are different in what they can do**, and this
-- is where that is stated. Every action written so far edits a job that already exists; a
-- counter rule fires before there is one. So the subject decides which actions apply, and an
-- action that does not apply to this subject is skipped rather than failing — a business may
-- reasonably put two actions on one rule and expect the applicable one to run.
create or replace function app.run_automation(
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
      -- why this work exists — "Service the compressor every five hundred hours". There is
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
$fn$;

-- ---------------------------------------------------------------------------
-- What fires it
-- ---------------------------------------------------------------------------

-- The same shape as the event trigger: inside the write that caused it, each rule in its own
-- subtransaction, and never inside another automation. What differs is the question — how far
-- has this counter moved since this rule last acted.
create function app.fire_counter_automations()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_rule public.automation_rules;
  v_mark public.automation_counter_marks;
begin
  if app.acting_automation() is not null then
    return null;
  end if;

  if not exists (
    select 1 from public.organization_modules m
     where m.organization_id = new.organization_id and m.module_key = 'automations'
  ) then
    return null;
  end if;

  for v_rule in
    select * from public.automation_rules r
     where r.organization_id = new.organization_id
       and r.enabled
       and r.trigger_kind = 'counter_threshold'
       -- Compared, never converted. A rule counting hours takes no notice of a reading in
       -- kilometres, which is the same refusal the weather rules make about units.
       and r.trigger_unit = new.unit
     order by r.created_at
  loop
    select * into v_mark
      from public.automation_counter_marks
     where organization_id = new.organization_id
       and rule_id = v_rule.id
       and asset_id = new.asset_id;

    -- **The first reading sets the mark and does nothing.** Switching a rule on for a machine
    -- that has already run nine hundred hours must not raise nine services that were done years
    -- ago; what a business means is "from here".
    if v_mark.rule_id is null then
      insert into public.automation_counter_marks
        (organization_id, rule_id, asset_id, last_value)
      values (new.organization_id, v_rule.id, new.asset_id, new.value)
      on conflict do nothing;
      continue;
    end if;

    -- A counter that has gone backwards is a replaced meter or a correction, not work due. The
    -- mark follows it down so the next interval is measured from the new reading.
    if new.value < v_mark.last_value then
      update public.automation_counter_marks
         set last_value = new.value, updated_at = now()
       where organization_id = new.organization_id
         and rule_id = v_rule.id
         and asset_id = new.asset_id;
      continue;
    end if;

    if new.value - v_mark.last_value < v_rule.trigger_counter_step then
      continue;
    end if;

    begin
      if app.run_automation(v_rule.id, 'asset', new.asset_id) then
        insert into public.automation_runs
          (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome)
        values
          (new.organization_id, v_rule.id, v_rule.name, 'counter_threshold', 'asset',
           new.asset_id, 'done');
      end if;

      -- **Advanced by whole steps rather than set to the reading**, so a counter that jumps
      -- three intervals at once leaves two still owing rather than swallowing them. A business
      -- that reads its meter monthly and services every hundred hours gets every service.
      update public.automation_counter_marks
         set last_value = v_mark.last_value + v_rule.trigger_counter_step,
             updated_at = now()
       where organization_id = new.organization_id
         and rule_id = v_rule.id
         and asset_id = new.asset_id;
    exception when others then
      insert into public.automation_runs
        (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome,
         detail)
      values
        (new.organization_id, v_rule.id, v_rule.name, 'counter_threshold', 'asset',
         new.asset_id, 'failed', sqlerrm);

      -- The mark moves even on a failure. Leaving it would fire the same failing rule at every
      -- reading from now on, burying the one row somebody needs to see under a thousand.
      update public.automation_counter_marks
         set last_value = v_mark.last_value + v_rule.trigger_counter_step,
             updated_at = now()
       where organization_id = new.organization_id
         and rule_id = v_rule.id
         and asset_id = new.asset_id;
    end;
  end loop;

  return null;
end;
$fn$;

create trigger asset_readings_fire_automations
  after insert on public.asset_readings
  for each row execute function app.fire_counter_automations();
