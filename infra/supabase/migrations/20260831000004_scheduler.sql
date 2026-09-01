-- The clock, and the role that turns it.
--
-- D2 gives Python the scheduled work and D24 says what shape it may take: **a scheduled
-- invocation that asks what is due, never a worker daemon holding a queue in memory.** So there
-- is no queue table here. What is due is a *query* — jobs starting soon that this rule has not
-- already acted on — and anything that must survive between invocations was already a row.
--
-- **`apps/api` gets its own Postgres role and no table grant**, which is `payment_webhook`'s
-- shape (D26) and the second time this platform has needed a writer with no human behind it.
-- A handful of `execute` grants and nothing else: ask what is due, take the queued messages, say
-- whether one was sent. It cannot read a customer, cannot read a job, and cannot write a row
-- through any table. The weather slice adds two more executes on the same terms.
--
-- **Retrying is safe and is what makes this need no bookkeeping.** A rule that moves a job to a
-- status it is already in does nothing; a rule that writes a message that has already been
-- queued hits `message_deliveries_once_per_reason` and does nothing. Both were true before this
-- migration, for their own reasons, and together they mean a tick that runs twice is a tick
-- that ran once.

-- ---------------------------------------------------------------------------
-- A rule that fires at a time
-- ---------------------------------------------------------------------------

alter table public.automation_rules
  drop constraint automation_rules_trigger_kind_check;

alter table public.automation_rules
  add constraint automation_rules_trigger_kind_check
  check (trigger_kind in ('event', 'schedule'));

-- **Relative to the job, not to the calendar.** "Every morning at seven" is a report; "two
-- hours before the job starts" is what a business actually wants to say to a customer, and it
-- is the one that needs the job in hand. A wall-clock schedule is a different trigger with a
-- different question and arrives when something asks for it.
alter table public.automation_rules
  add column trigger_offset_minutes integer
    check (trigger_offset_minutes is null
           or trigger_offset_minutes between -20160 and 20160);

comment on column public.automation_rules.trigger_offset_minutes is
  'Minutes from the scheduled start. Negative is before, which is what a reminder is. Null for every trigger kind that is not a schedule.';

alter table public.automation_rules
  drop constraint automation_rules_trigger_is_complete;

alter table public.automation_rules
  add constraint automation_rules_trigger_is_complete
  check (
    (trigger_kind = 'event'
       and trigger_event_action is not null and trigger_offset_minutes is null)
    or (trigger_kind = 'schedule'
       and trigger_event_action is null and trigger_offset_minutes is not null)
  );

-- ---------------------------------------------------------------------------
-- What is due
-- ---------------------------------------------------------------------------

-- **One query, and it is the whole scheduler.** A rule is due for a job when the moment it
-- names has arrived and has not gone stale, and when this rule has not already acted on this
-- job. `automation_runs` is the record of the last part, which is why it needed no table of its
-- own — the substrate `roadmap.md` M5 deferred to this milestone is also the bookkeeping this
-- one would otherwise have invented.
--
-- The window is bounded at both ends. Without a lower bound, switching a rule on would fire it
-- at every job in the past; a tick that missed its slot by an hour catches up, and one that has
-- been off for a week does not shout at a customer about last Tuesday.
create function app.due_scheduled_automations(p_grace interval default interval '2 hours')
returns table (rule_id uuid, organization_id uuid, work_item_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id, r.organization_id, w.id
    from public.automation_rules r
    join public.organization_modules m
      on m.organization_id = r.organization_id
     and m.module_key = 'automations'
    join public.work_items w
      on w.organization_id = r.organization_id
     and w.scheduled_during is not null
   where r.enabled
     and r.trigger_kind = 'schedule'
     -- The instant this rule names for this job, which is the start of its window shifted by
     -- what the business typed. Absolute, so a tenant's timezone never enters into it (I9).
     and lower(w.scheduled_during) + make_interval(mins => r.trigger_offset_minutes) <= now()
     and lower(w.scheduled_during) + make_interval(mins => r.trigger_offset_minutes) > now() - p_grace
     and not exists (
       select 1 from public.automation_runs run
        where run.organization_id = r.organization_id
          and run.rule_id = r.id
          and run.subject_id = w.id
     );
$fn$;

-- ---------------------------------------------------------------------------
-- Turning the handle
-- ---------------------------------------------------------------------------

-- Each rule in its own subtransaction, exactly as the event trigger does and for the same
-- reason: one business's bad rule may not stop another business's good one. Here the stakes are
-- higher than inside a request — nobody is watching a scheduled run, so an exception that
-- escaped would silently abandon every tenant after the one that raised it.
create function public.run_due_automations()
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
  for v_due in select * from app.due_scheduled_automations() loop
    select * into v_rule from public.automation_rules where id = v_due.rule_id;

    begin
      if app.run_automation(v_rule.id, 'work_item', v_due.work_item_id) then
        insert into public.automation_runs
          (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome)
        values
          (v_due.organization_id, v_rule.id, v_rule.name, 'schedule', 'work_item',
           v_due.work_item_id, 'done');
        v_count := v_count + 1;
      end if;
    exception when others then
      insert into public.automation_runs
        (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome,
         detail)
      values
        (v_due.organization_id, v_rule.id, v_rule.name, 'schedule', 'work_item',
         v_due.work_item_id, 'failed', sqlerrm);
      v_count := v_count + 1;
    end;
  end loop;

  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- What is waiting to be sent
-- ---------------------------------------------------------------------------

-- **Everything the sender needs and nothing it does not.** No customer row, no job, no
-- organization — an address and the finished words, which were resolved when the message was
-- queued. A sender that could read a customer would be a sender that could be asked to.
create function public.queued_messages(p_limit integer default 50)
returns table (
  id           uuid,
  channel      text,
  recipient    text,
  subject_line text,
  body         text
)
language sql
volatile
security definer
set search_path = ''
as $fn$
  select d.id, d.channel, d.recipient, d.subject_line, d.body
    from public.message_deliveries d
   where d.state = 'queued'
   order by d.queued_at
   limit least(greatest(p_limit, 1), 200);
$fn$;

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

-- `nologin` and `noinherit`, like `payment_webhook`: it is reached only by PostgREST switching
-- into it from a signed token, never by connecting as it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'automation_runner') then
    create role automation_runner nologin noinherit;
  end if;
end
$$;

grant automation_runner to authenticator;
grant usage on schema public to automation_runner;

-- **Revoked from public first, and this is not a formality.** Postgres grants `execute` on a
-- new function to PUBLIC by default, and both of these run `security definer` — so without
-- these two lines `queued_messages` would hand any signed-in member of any business every other
-- business's queued messages, addresses and words included. It was written that way, and the
-- privilege test in `automations.test.ts` is what caught it: it asserts the runner's executes by
-- *excluding* everything PUBLIC can already run, so a function left open to everybody vanishes
-- from the list rather than appearing in it. A test that had listed grants directly would have
-- passed.
revoke all on function public.run_due_automations() from public;
revoke all on function public.queued_messages(integer) from public;

-- **No table grant of any kind, and that is half the invariant** (I21's shape, applied to a
-- different axis). A permissive policy added here by a careless author later still hits a
-- missing privilege. The test asserts the emptiness rather than trusting this comment.
grant execute on function public.run_due_automations() to automation_runner;
grant execute on function public.queued_messages(integer) to automation_runner;
grant execute on function public.record_message_delivery(uuid, boolean, text) to automation_runner;
