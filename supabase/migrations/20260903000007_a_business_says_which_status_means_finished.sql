-- A business says which of its statuses means the work was done.
--
-- **This is M4's shape, not M4's refusal being overturned.** That milestone declined to answer
-- "does cancelling free the resource" with a platform-owned `is_terminal`, and answered it with a
-- tenant question instead — `releases_resource`. The same move applies here, and the existing
-- column is exactly why a second one is needed rather than a reuse: **Cancelled releases the
-- resource and is not completed work.** Two different questions about one status, which is
-- precisely what M4 was right not to collapse into a single flag.
--
-- **The date was never missing, and `roadmap.md` M7 carries that correction.** `events` has been
-- recording `work_item.status_changed` with `occurred_at`, `from_status_id` and `to_status_id`
-- since M2. What was missing is the answer below. `customer_activity` is the precedent for
-- reading that log to answer a business question, and this reads it the same way.
--
-- **What it can honestly report is *marked* complete.** `occurred_at` defaults to `now()` and
-- nothing passes a value, so the log holds the moment somebody moved the job rather than the
-- moment work stopped. The report is named for what it measures, on the same discipline that
-- made the financial set say invoiced rather than revenue. If a business ever needs the other
-- instant, that is a caller-supplied date on `change_work_item_status` and its own slice.

-- ---------------------------------------------------------------------------
-- The question
-- ---------------------------------------------------------------------------

-- Default false, because a business that has said nothing has asserted nothing -- the reading
-- `operating_hours` gets, and deliberately the opposite of I13, where an empty transition set
-- genuinely asserts that no move is legal. An unanswered question here means a business reports
-- no completed work, which is true of a business that has not said what finished means.
alter table public.work_item_statuses
  add column marks_complete boolean not null default false;

comment on column public.work_item_statuses.marks_complete is
  'Whether moving work into this status means the work was done. A tenant''s answer, not a platform concept -- and separate from releases_resource, because Cancelled frees the resource and is not completed work. See M4 for why this shape rather than is_terminal.';

-- **A column grant, added to the one that exists rather than a table-wide one.** `create` is
-- through `create_work_item_status`; this is what an operator may edit afterwards.
grant update (marks_complete) on public.work_item_statuses to authenticated;

-- The editing function gains the answer. Replaced rather than altered: a fifth parameter is a new
-- signature, so the four-argument version goes.
drop function public.update_work_item_status(uuid, text, integer, boolean);

create function public.update_work_item_status(
  p_id                uuid,
  p_name              text,
  p_position          integer,
  p_releases_resource boolean,
  p_marks_complete    boolean
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'update_work_item_status requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The policy on `work_item_statuses` is what refuses somebody without the capability; this
  -- reads the row first only so the event below can name the organization.
  select s.organization_id into v_org
    from public.work_item_statuses s
   where s.id = p_id;

  if v_org is null then
    raise exception 'no such status, or you may not change it'
      using errcode = '42501';
  end if;

  update public.work_item_statuses
     set name              = p_name,
         position          = p_position,
         releases_resource = p_releases_resource,
         marks_complete    = p_marks_complete
   where id = p_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_status', p_id, 'work_item_status.updated',
     jsonb_build_object(
       'name', p_name,
       'position', p_position,
       'releases_resource', p_releases_resource,
       'marks_complete', p_marks_complete
     ));
end;
$fn$;

revoke all on function public.update_work_item_status(uuid, text, integer, boolean, boolean) from public;
grant execute on function public.update_work_item_status(uuid, text, integer, boolean, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The second measure
-- ---------------------------------------------------------------------------

-- **A count, not an amount**, which is why it is a second function rather than a column on the
-- first. Everything else about it is `invoiced_and_incurred`'s shape: `stable`, `security
-- invoker`, narrowed by RLS rather than by its argument, gated by `report.read`, and given a
-- period as two dates the business's own zone is applied to here (D35).
--
-- **No service grouping, and the absence is a fact rather than a gap.** A job is finished as a
-- whole; splitting one completion across the priced lines on it would mean inventing a rule about
-- how, which is the same refusal that leaves the money report with no cost per service.
--
-- **It reads the event log rather than the work item.** A job's current status says what is true
-- now; *finished in August* is a question about what happened then, and only `events` knows. The
-- consequence is deliberate and belongs on the screen: a job marked finished in August and
-- reopened in September was finished in August. The event happened.
create function public.work_marked_complete(
  p_organization_id uuid,
  p_grouping        text,
  p_from            date default null,
  p_to              date default null,
  p_customer_id     uuid default null,
  p_resource_id     uuid default null,
  p_location_id     uuid default null
)
returns table (
  group_id    uuid,
  group_label text,
  jobs        bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_zone text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_grouping not in ('customer', 'resource', 'location') then
    raise exception 'unknown grouping: %', p_grouping using errcode = '22023';
  end if;

  if not app.has_capability(p_organization_id, 'report.read') then
    raise exception 'you may not read this business''s figures'
      using errcode = '42501';
  end if;

  select o.timezone into v_zone
    from public.organizations o
   where o.id = p_organization_id;

  v_zone := coalesce(v_zone, 'UTC');
  v_from := case when p_from is not null then p_from::timestamp at time zone v_zone end;
  v_to   := case when p_to   is not null then p_to::timestamp   at time zone v_zone end;

  return query
  with finished as (
    select distinct
           e.entity_id as work_item_id,
           w.customer_id,
           w.resource_id,
           w.location_id
      from public.events e
      join public.work_items w
        on w.organization_id = e.organization_id
       and w.id = e.entity_id
      -- Which status it moved *into*, resolved against the tenant's own answer. The join is part
      -- of what this discloses (D34): a caller who may not read this business's board vocabulary
      -- gets nothing rather than a wrong count.
      join public.work_item_statuses s
        on s.organization_id = e.organization_id
       and s.id = (e.payload ->> 'to_status_id')::uuid
     where e.organization_id = p_organization_id
       and e.entity_type = 'work_item'
       and e.action = 'work_item.status_changed'
       and s.marks_complete
       and (v_from is null or e.occurred_at >= v_from)
       and (v_to is null or e.occurred_at < v_to)
       and (p_customer_id is null or w.customer_id = p_customer_id)
       and (p_resource_id is null or w.resource_id = p_resource_id)
       and (p_location_id is null or w.location_id = p_location_id)
  )
  -- `distinct` above rather than here, and it is load-bearing: a job moved out of a finishing
  -- status and back into it within one period was finished once, not twice. Counting the events
  -- would make a business that corrects a mistake look busier than one that does not.
  select case p_grouping
           when 'customer' then f.customer_id
           when 'resource' then f.resource_id
           when 'location' then f.location_id
         end,
         case p_grouping
           when 'customer' then cu.name
           when 'resource' then r.name
           when 'location' then lo.label
         end,
         count(*)::bigint
    from finished f
    left join public.customers cu
      on p_grouping = 'customer'
     and cu.organization_id = p_organization_id
     and cu.id = f.customer_id
    left join public.resources r
      on p_grouping = 'resource'
     and r.organization_id = p_organization_id
     and r.id = f.resource_id
    left join public.locations lo
      on p_grouping = 'location'
     and lo.organization_id = p_organization_id
     and lo.id = f.location_id
   group by 1, 2
   order by 3 desc, 2 nulls last;
end;
$fn$;

comment on function public.work_marked_complete(uuid, text, date, date, uuid, uuid, uuid) is
  'How many jobs were moved into a status this business marks as finished, in a period, grouped by customer, resource or location. Counts jobs rather than events, so correcting a mistake does not inflate it. Marked rather than completed: the log holds when somebody said so, not when work stopped. Requires report.read. See D35.';

revoke execute on function public.work_marked_complete(uuid, text, date, date, uuid, uuid, uuid) from public;
grant execute on function public.work_marked_complete(uuid, text, date, date, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A saved report says which measure it is
-- ---------------------------------------------------------------------------

-- **D36 said this day would come and what to do about it.** That record permits a definition to
-- hold a grouping, a period and filters *for this report set*, and says the moment a set arrives
-- whose fields are not fixed is when the argument for a query language has to be made. It is not
-- made: the fields stay fixed **per measure**, so a report gains one column from a closed list.
alter table public.report_definitions
  add column measure text not null default 'invoiced_and_incurred'
    check (measure in ('invoiced_and_incurred', 'work_marked_complete'));

comment on column public.report_definitions.measure is
  'Which aggregate this report is of. A closed list, checked here -- adding one means writing the SQL function it names. See D36.';

-- Every report that existed before this migration is a money report, which the default says.
-- Insertable and editable, because choosing what a report measures is choosing what it is.
grant insert (measure) on public.report_definitions to authenticated;
grant update (measure) on public.report_definitions to authenticated;

-- **The pair a completion report cannot be.** Grouping by service is refused by
-- `work_marked_complete` at execution; this refuses it being *saved*, so a report that could only
-- ever fail is not stored as one somebody will click. Same reasoning D34 gives for validating an
-- intended action when it is written rather than when somebody presses the button.
alter table public.report_definitions
  add constraint report_definitions_grouping_answerable
  check (measure <> 'work_marked_complete' or grouping <> 'service');
