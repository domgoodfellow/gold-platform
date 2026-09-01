-- A reading from outside, and a rule written against it.
--
-- **This is the whole of D11 as a schema.** Weather is a perfectly good *module* — a
-- weather-dependent business switches it on and is billed for it — and emphatically not an
-- engine: it owns no entity and no rule of its own. What it needs is a place, a number, and
-- somewhere for a business to say what number matters. There is no `weather` table, no forecast
-- model, and no directory anywhere in this repository named after it.
--
-- **The metric is a string this platform names and a business chooses from**, in the shape
-- `roles_capabilities_known` established: adding one means an adapter that can answer it. The
-- *threshold* is the business's, the *unit* is the business's, and neither is anywhere in this
-- file.
--
-- **A reading is an observation, not a fact about the future that gets corrected.** Two readings
-- for the same place and hour taken an hour apart are two rows, both true about when they were
-- taken. Nothing updates one, which is the same reason `work_item_costs` corrects with a new row
-- rather than an edit.

-- ---------------------------------------------------------------------------
-- external_readings
-- ---------------------------------------------------------------------------

create table public.external_readings (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  location_id     uuid        not null,

  -- What was measured. Platform vocabulary: each names something an adapter can be asked for.
  metric          text        not null
                              check (metric in ('temperature', 'wind_speed', 'precipitation')),

  -- The number, and what it is in. **The unit travels with the value and is never assumed** —
  -- the same rule money already follows (I10), and for the same reason: a business in Amsterdam
  -- and one in Denver do not mean the same thing by "20".
  value           double precision not null,
  unit            text        not null check (length(btrim(unit)) between 1 and 16),

  -- The hour this reading is *about*, which is not the hour it was taken in. A forecast for
  -- Tuesday fetched on Monday has both, and a rule asks about the first.
  applies_at      timestamptz not null,
  observed_at     timestamptz not null default now(),

  constraint external_readings_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete cascade
);

comment on table public.external_readings is
  'What some provider said about a place at a time. Append-only observations; a later reading is a new row, never an edit.';

-- I2 leads it. The lookup a rule performs: this place, this metric, around this hour, most
-- recently observed.
create index external_readings_org_lookup_idx
  on public.external_readings (organization_id, location_id, metric, applies_at desc, observed_at desc);

alter table public.external_readings enable row level security;
alter table public.external_readings force row level security;

create policy external_readings_select on public.external_readings
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- **No insert policy for a member, and that is deliberate.** A reading is what somebody outside
-- said, and a business that could type its own would be a business that could make its own rules
-- fire. It is written by the fetcher through the function below and by nothing else.
grant select on public.external_readings to authenticated;

-- ---------------------------------------------------------------------------
-- Writing one down
-- ---------------------------------------------------------------------------

-- The fetcher's only write, and it names a location rather than an organization — the row
-- already knows which business owns it, exactly as `record_provider_payment` and
-- `record_message_delivery` do not take one either.
create function public.record_external_reading(
  p_location_id uuid,
  p_metric      text,
  p_value       double precision,
  p_unit        text,
  p_applies_at  timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_id  uuid;
begin
  select organization_id into v_org from public.locations where id = p_location_id;
  if v_org is null then
    raise exception 'no such location' using errcode = '42501';
  end if;

  insert into public.external_readings
    (organization_id, location_id, metric, value, unit, applies_at)
  values (v_org, p_location_id, p_metric, p_value, p_unit, p_applies_at)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.record_external_reading(uuid, text, double precision, text, timestamptz)
  from public;
grant execute on function public.record_external_reading(uuid, text, double precision, text, timestamptz)
  to automation_runner;

-- ---------------------------------------------------------------------------
-- A rule that fires on a reading
-- ---------------------------------------------------------------------------

alter table public.automation_rules
  drop constraint automation_rules_trigger_kind_check;

alter table public.automation_rules
  add constraint automation_rules_trigger_kind_check
  check (trigger_kind in ('event', 'schedule', 'external_reading'));

alter table public.automation_rules
  add column trigger_metric    text
    check (trigger_metric is null
           or trigger_metric in ('temperature', 'wind_speed', 'precipitation')),
  -- Which way the line is crossed, and where the business drew it. Both the number and the unit
  -- are typed by the business; nothing here has a default, and there is no platform opinion
  -- about what counts as bad weather.
  add column trigger_comparison text
    check (trigger_comparison is null or trigger_comparison in ('above', 'below')),
  add column trigger_threshold  double precision,
  add column trigger_unit       text
    check (trigger_unit is null or length(btrim(trigger_unit)) between 1 and 16);

alter table public.automation_rules
  drop constraint automation_rules_trigger_is_complete;

alter table public.automation_rules
  add constraint automation_rules_trigger_is_complete
  check (
    case trigger_kind
      when 'event' then
        trigger_event_action is not null
        and trigger_offset_minutes is null and trigger_metric is null
      when 'schedule' then
        trigger_offset_minutes is not null
        and trigger_event_action is null and trigger_metric is null
      when 'external_reading' then
        trigger_event_action is null and trigger_offset_minutes is null
        and trigger_metric is not null and trigger_comparison is not null
        and trigger_threshold is not null and trigger_unit is not null
      else false
    end
  );

revoke update on public.automation_rules from authenticated;
grant update (name, enabled) on public.automation_rules to authenticated;

-- Places worth asking about: somewhere a job is scheduled, for a business that has switched the
-- module on and written a rule that reads that metric. **The fetcher is told where to look by
-- the rules**, so a business that writes no weather rule is never the subject of a request to
-- anybody.
create function public.places_to_watch()
returns table (location_id uuid, latitude double precision, longitude double precision, metric text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct l.id, l.latitude, l.longitude, r.trigger_metric
    from public.automation_rules r
    join public.organization_modules m
      on m.organization_id = r.organization_id and m.module_key = 'automations'
    join public.work_items w
      on w.organization_id = r.organization_id
     and w.scheduled_during is not null
     and lower(w.scheduled_during) between now() and now() + interval '7 days'
    join public.locations l
      on l.organization_id = r.organization_id
     and l.id = w.location_id
     and l.latitude is not null
     and l.longitude is not null
   where r.enabled
     and r.trigger_kind = 'external_reading';
$fn$;

revoke all on function public.places_to_watch() from public;
grant execute on function public.places_to_watch() to automation_runner;

-- ---------------------------------------------------------------------------
-- Moving a job that the weather has spoiled
-- ---------------------------------------------------------------------------

-- **The action shifts by an offset the business typed, and does not search for a free slot.**
-- Searching is `freeWindows`, and a second copy of it here would be a second availability
-- calculation in a second runtime, which is exactly what I5 exists to forbid (D30). What decides
-- whether the new window lands is `work_items_resource_not_double_booked` — I6 doing the job it
-- was written for, rather than a check that would race identically. A refusal is a recorded
-- failure a dispatcher reads, never a silent skip.
alter table public.automation_actions
  add column shift_minutes integer
    check (shift_minutes is null or shift_minutes between -20160 and 20160);

alter table public.automation_actions
  drop constraint automation_actions_action_kind_check;

alter table public.automation_actions
  add constraint automation_actions_action_kind_check
  check (action_kind in ('change_status', 'notify', 'shift_schedule'));

alter table public.automation_actions
  drop constraint automation_actions_config_matches_kind;

alter table public.automation_actions
  add constraint automation_actions_config_matches_kind
  check (
    case action_kind
      when 'change_status' then
        status_id is not null and template_id is null and channel is null
        and shift_minutes is null
      when 'notify' then
        status_id is null and template_id is not null and channel is not null
        and shift_minutes is null
      when 'shift_schedule' then
        status_id is null and template_id is null and channel is null
        and shift_minutes is not null and shift_minutes <> 0
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- What is due, on a reading
-- ---------------------------------------------------------------------------

-- The same shape `due_scheduled_automations` has, asking a different question: a job scheduled
-- at a place where the most recent reading for this metric crosses the line this business drew.
--
-- **The unit is compared, not converted.** A rule written in one unit against a reading taken in
-- another is not a rule that half-works; it is a rule about something else. This is the same
-- refusal `jobEconomics` makes about currency — a conversion has a date, and a date makes this a
-- different kind of software.
create function app.due_reading_automations()
returns table (rule_id uuid, organization_id uuid, work_item_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id, r.organization_id, w.id
    from public.automation_rules r
    join public.organization_modules m
      on m.organization_id = r.organization_id and m.module_key = 'automations'
    join public.work_items w
      on w.organization_id = r.organization_id
     and w.scheduled_during is not null
     and w.location_id is not null
     and lower(w.scheduled_during) > now()
   cross join lateral (
     select e.value, e.unit
       from public.external_readings e
      where e.organization_id = r.organization_id
        and e.location_id = w.location_id
        and e.metric = r.trigger_metric
        -- The reading about the hour the job starts in, most recently observed.
        and e.applies_at between lower(w.scheduled_during) - interval '1 hour'
                             and lower(w.scheduled_during) + interval '1 hour'
      order by e.observed_at desc
      limit 1
   ) reading
   where r.enabled
     and r.trigger_kind = 'external_reading'
     and reading.unit = r.trigger_unit
     and case r.trigger_comparison
           when 'above' then reading.value > r.trigger_threshold
           when 'below' then reading.value < r.trigger_threshold
         end
     and not exists (
       select 1 from public.automation_runs run
        where run.organization_id = r.organization_id
          and run.rule_id = r.id
          and run.subject_id = w.id
     );
$fn$;

-- ---------------------------------------------------------------------------
-- Two more things the runtime can do
-- ---------------------------------------------------------------------------

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
  v_acted     boolean := false;
begin
  select * into v_rule from public.automation_rules where id = p_rule_id;
  if v_rule.id is null or not v_rule.enabled then
    return false;
  end if;

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

  perform set_config('app.automation_rule_id', v_rule.id::text, true);

  for v_action in
    select * from public.automation_actions
     where rule_id = v_rule.id
     order by position, created_at
  loop
    if v_action.action_kind = 'change_status' then
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

      -- The exclusion constraint decides whether this lands (I6, I7). If somebody else holds
      -- that resource then the move is refused, the subtransaction above this one rolls it back,
      -- and the failure is recorded where a dispatcher reads it — which is a better answer than
      -- a rule that quietly gives up.
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

      -- Re-read, so a later action in the same rule sees the moved window rather than the old
      -- one. A rule that shifts a job and then tells the customer about it must not send the
      -- time it used to be at.
      select * into v_item from public.work_items where id = v_item.id;

      v_acted := true;

    elsif v_action.action_kind = 'notify' then
      select * into v_template
        from public.message_templates
       where id = v_action.template_id;

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
          v_rule.organization_id,
          v_rule.id,
          v_rule.name,
          'work_item',
          v_item.id,
          v_action.channel,
          v_recipient,
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
-- Turning the handle, on both questions
-- ---------------------------------------------------------------------------

create or replace function public.run_due_automations()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_due   record;
  v_rule  public.automation_rules;
  v_count integer := 0;
begin
  for v_due in
    select * from app.due_scheduled_automations()
    union all
    select * from app.due_reading_automations()
  loop
    select * into v_rule from public.automation_rules where id = v_due.rule_id;

    begin
      if app.run_automation(v_rule.id, 'work_item', v_due.work_item_id) then
        insert into public.automation_runs
          (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome)
        values
          (v_due.organization_id, v_rule.id, v_rule.name, v_rule.trigger_kind, 'work_item',
           v_due.work_item_id, 'done');
        v_count := v_count + 1;
      end if;
    exception when others then
      insert into public.automation_runs
        (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome,
         detail)
      values
        (v_due.organization_id, v_rule.id, v_rule.name, v_rule.trigger_kind, 'work_item',
         v_due.work_item_id, 'failed', sqlerrm);
      v_count := v_count + 1;
    end;
  end loop;

  return v_count;
end;
$fn$;

revoke all on function public.run_due_automations() from public;
grant execute on function public.run_due_automations() to automation_runner;
