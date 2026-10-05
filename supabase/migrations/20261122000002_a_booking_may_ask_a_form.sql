-- A booking may ask the business's own questions, and the answers are recorded with the booking.
--
-- **Booking owns the booking; Forms owns the questions.** Service, slot, resources, price and
-- status stay `create_booking`'s. A business may point a bookable type at one of its forms
-- (`work_item_types.booking_intake_form_id`) and the booking page renders that form's published
-- revision beside the booking's own name and contact fields. The type holds a *reference*; nothing
-- of the form's schema is copied into Booking.
--
-- **One transaction, because both writes are in one database.** The earlier decision (D77) recorded
-- the answers after the booking succeeded. That left a window where a booking existed and the
-- customer's answers were gone, and the answers a second write could lose were exactly the ones the
-- business had asked for. `create_booking` now records the submission itself, through the same
-- `app.record_form_submission` every other door ends in, so a stale revision or an invalid answer
-- refuses the *booking* — no slot is held, nothing is half-written.
--
-- **Rate limiting.** The generic flood guard on a form (thirty responses a minute) is skipped for a
-- booking-linked response. A legitimate booking must not be refused by a limit that exists to
-- protect an inbox; the abuse controls on this path are the booking's own (one booking per visitor,
-- a resource that must be free, and the visitor's binding to this one business).

alter table public.work_item_types add column booking_intake_form_id uuid;
alter table public.work_item_types
  add constraint work_item_types_booking_intake_same_org
    foreign key (organization_id, booking_intake_form_id)
    references public.forms (organization_id, id),
  add constraint work_item_types_intake_needs_booking
    check (booking_intake_form_id is null or booking_status_id is not null);

comment on column public.work_item_types.booking_intake_form_id is
  'A form of this business whose published revision a public booking of this type asks, answered in the same transaction as the booking. A reference, never a copy.';

-- Offered only when the form can be answered: the same business, not archived, and published. Held
-- by a trigger so every writer meets it, not only the one screen.
create function app.check_booking_intake_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.booking_intake_form_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.booking_intake_form_id is not distinct from old.booking_intake_form_id then return new; end if;
  if not exists (
    select 1 from public.forms f
     where f.organization_id = new.organization_id and f.id = new.booking_intake_form_id
       and f.archived_at is null and f.current_published_revision_id is not null) then
    raise exception 'a booking can only ask a form that is published and not archived' using errcode = 'GD016';
  end if;
  return new;
end;
$fn$;
revoke all on function app.check_booking_intake_form() from public, anon, authenticated;

create trigger work_item_types_booking_intake_form
  before insert or update of booking_intake_form_id on public.work_item_types
  for each row execute function app.check_booking_intake_form();

grant update (booking_intake_form_id) on public.work_item_types to authenticated;

-- Withdrawing a type from the public page also withdraws its questions: the check above says a type
-- that is not bookable asks nothing, so the one call that clears the status must clear the form.
create or replace function public.set_type_bookable(
  p_id               uuid,
  p_status_id        uuid,
  p_duration_minutes integer,
  p_price_item_id    uuid
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
    raise exception 'set_type_bookable requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_item_types
     set booking_status_id        = p_status_id,
         booking_duration_minutes = p_duration_minutes,
         booking_price_item_id    = p_price_item_id,
         booking_intake_form_id   = case when p_status_id is null then null else booking_intake_form_id end
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such work item type, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', p_id, 'work_item_type.booking_configured',
     jsonb_build_object(
       'booking_status_id', p_status_id,
       'booking_duration_minutes', p_duration_minutes,
       'booking_price_item_id', p_price_item_id
     ));
end;
$fn$;

create function public.set_type_booking_intake(p_type_id uuid, p_form_id uuid)
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
    raise exception 'set_type_booking_intake requires an authenticated caller' using errcode = '42501';
  end if;
  update public.work_item_types set booking_intake_form_id = p_form_id
   where id = p_type_id
  returning organization_id into v_org;
  if v_org is null then
    raise exception 'no such work item type, or you may not change it' using errcode = '42501';
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_org, v_actor, 'work_item_type', p_type_id, 'work_item_type.booking_intake_configured',
          jsonb_build_object('form_id', p_form_id));
end;
$fn$;
revoke all on function public.set_type_booking_intake(uuid, uuid) from public;
grant execute on function public.set_type_booking_intake(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What a booking-linked response records
-- ---------------------------------------------------------------------------

-- Which booking produced a response. `on delete set null`: removing a job leaves the answers, as
-- removing a customer does. The check only forbids the link on any source but `booking`.
alter table public.form_submissions add column booking_work_item_id uuid;
alter table public.form_submissions
  add constraint form_submissions_booking_fk
    foreign key (organization_id, booking_work_item_id)
    references public.work_items (organization_id, id) on delete set null (booking_work_item_id),
  add constraint form_submissions_booking_link_is_booking
    check (booking_work_item_id is null or source = 'booking');
create unique index form_submissions_one_per_booking
  on public.form_submissions (organization_id, booking_work_item_id) where booking_work_item_id is not null;

drop function app.record_form_submission(uuid, uuid, uuid, jsonb, text, uuid, uuid);

create function app.record_form_submission(
  p_organization_id uuid, p_form_id uuid, p_revision_id uuid, p_answers jsonb,
  p_source text, p_actor uuid, p_customer_id uuid, p_booking_work_item_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_current uuid;
  v_archived timestamptz;
  v_definition jsonb;
  v_number integer;
  v_problem text;
  v_submission uuid;
begin
  select current_published_revision_id, archived_at into v_current, v_archived
    from public.forms where organization_id = p_organization_id and id = p_form_id;
  if v_current is null or v_archived is not null then
    raise exception 'this form is not accepting responses' using errcode = 'GD001';
  end if;
  if v_current is distinct from p_revision_id then
    raise exception 'this form has changed since it was opened' using errcode = 'GD002';
  end if;

  -- A booking-linked response is limited by the booking, not by this guard (see the header).
  if p_booking_work_item_id is null and (select count(*) from public.form_submissions
       where organization_id = p_organization_id and form_id = p_form_id
         and submitted_at > now() - interval '1 minute') >= app.form_submissions_per_minute() then
    raise exception 'this form is receiving too many responses right now; try again shortly' using errcode = 'GD003';
  end if;

  select definition, revision_number into v_definition, v_number from public.form_revisions
   where organization_id = p_organization_id and form_id = p_form_id and id = v_current and status = 'published';

  v_problem := app.form_answers_problem(v_definition, p_answers);
  if v_problem is not null then raise exception '%', v_problem using errcode = '23514'; end if;

  insert into public.form_submissions
    (organization_id, form_id, form_revision_id, submitted_by, answers, source, customer_id, booking_work_item_id)
  values (p_organization_id, p_form_id, v_current, p_actor, p_answers, p_source, p_customer_id, p_booking_work_item_id)
  returning id into v_submission;

  -- Identifiers only: the answers stay in the submission (they are personal).
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, p_actor, 'form_submission', v_submission, 'form.submitted',
          jsonb_strip_nulls(jsonb_build_object('form_id', p_form_id, 'revision_id', v_current, 'revision_number', v_number,
                                               'source', p_source, 'work_item_id', p_booking_work_item_id)));

  return v_submission;
end;
$fn$;
revoke all on function app.record_form_submission(uuid, uuid, uuid, jsonb, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The booking
-- ---------------------------------------------------------------------------

drop function public.create_booking(uuid, uuid, jsonb, timestamptz, text, text, text);

create function public.create_booking(
  p_organization_id uuid,
  p_type_id         uuid,
  p_allocations     jsonb,
  p_starts_at       timestamptz,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_intake_revision_id uuid default null,
  p_intake_answers  jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_scope     uuid := app.current_external_tenant();
  v_type      public.work_item_types;
  v_email     text := nullif(btrim(p_email), '');
  v_customer  uuid;
  v_item      uuid;
  v_entry     jsonb;
  v_resource  uuid;
  v_req       uuid;
  v_needs     integer;
  v_resources uuid[] := '{}';
  v_intake_open boolean;
begin
  if v_actor is null then
    raise exception 'create_booking requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The whole authorization of this function: written out, because everything below runs privileged.
  if v_scope is null or v_scope is distinct from p_organization_id then
    raise exception 'you are not booking with this business'
      using errcode = '42501';
  end if;

  perform app.assert_module_enabled(p_organization_id, 'booking');

  -- One booking per visitor, with its own SQLSTATE: 23505 is also what a duplicate email raises.
  if exists (
    select 1 from public.work_items w
     where w.organization_id = p_organization_id and w.created_by = v_actor
  ) then
    raise exception 'this visitor has already booked'
      using errcode = 'GD001';
  end if;

  select * into v_type
    from public.work_item_types
   where id = p_type_id
     and organization_id = p_organization_id
     and booking_status_id is not null;

  if v_type.id is null then
    raise exception 'that is not something this business takes bookings for'
      using errcode = '42501';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'a booking names the resources it takes'
      using errcode = 'GD014';
  end if;

  -- **The certificate.** Each entry fills one slot of one requirement with one resource; together
  -- they must fill exactly what the type needs. Checked against current configuration -- class and
  -- capabilities can change between the page and the booking.
  for v_entry in select * from jsonb_array_elements(p_allocations) loop
    v_resource := nullif(v_entry ->> 'resource_id', '')::uuid;
    v_req := nullif(v_entry ->> 'requirement_id', '')::uuid;

    if v_resource is null or v_resource = any (v_resources) then
      raise exception 'a booking cannot use the same resource twice'
        using errcode = 'GD014';
    end if;
    v_resources := array_append(v_resources, v_resource);

    if v_req is null then
      if not exists (select 1 from public.resources r where r.organization_id = p_organization_id and r.id = v_resource) then
        raise exception 'that resource cannot do this work'
          using errcode = 'GD012';
      end if;
    elsif not exists (
      select 1 from public.work_item_type_resource_requirements q
       where q.organization_id = p_organization_id and q.type_id = p_type_id and q.id = v_req
    ) or not app.resource_is_eligible(p_organization_id, v_resource, v_req) then
      raise exception 'that resource cannot do this work'
        using errcode = 'GD012';
    end if;
  end loop;

  if exists (
    select 1 from public.work_item_type_resource_requirements q
     where q.organization_id = p_organization_id and q.type_id = p_type_id
  ) then
    -- Every requirement filled to exactly its quantity, and nothing named that no requirement asked for.
    if exists (
      select 1
        from public.work_item_type_resource_requirements q
       where q.organization_id = p_organization_id and q.type_id = p_type_id
         and q.quantity <> (
           select count(*) from jsonb_array_elements(p_allocations) e
            where nullif(e ->> 'requirement_id', '')::uuid = q.id)
    ) or exists (
      select 1 from jsonb_array_elements(p_allocations) e
       where nullif(e ->> 'requirement_id', '') is null
    ) then
      raise exception 'those resources do not fill what this work needs'
        using errcode = 'GD014';
    end if;
  else
    v_needs := jsonb_array_length(p_allocations);
    if v_needs <> 1 then
      raise exception 'those resources do not fill what this work needs'
        using errcode = 'GD014';
    end if;
  end if;

  -- A returning customer books against the record they already have.
  if v_email is not null then
    select c.id into v_customer
      from public.customers c
     where c.organization_id = p_organization_id
       and lower(c.email) = lower(v_email);
  end if;

  if v_customer is null then
    insert into public.customers (organization_id, name, email, phone, created_by)
    values (p_organization_id, p_name, v_email, nullif(btrim(p_phone), ''), v_actor)
    returning id into v_customer;
  end if;

  -- The duration is the type's, never the caller's.
  insert into public.work_items (
    organization_id, type_id, status_id, customer_id, title,
    scheduled_during, created_by
  )
  values (
    p_organization_id,
    p_type_id,
    v_type.booking_status_id,
    v_customer,
    v_type.name || ' — ' || p_name,
    tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_type.booking_duration_minutes), '[)'),
    v_actor
  )
  returning id into v_item;

  -- Every resource, in this one transaction. Each insert carries the window onto the resource's own
  -- row; the working-hours trigger and the exclusion constraint are what refuse a resource that
  -- stopped working or was taken -- and a refusal on any one rolls back the work item and all the
  -- others. No partial booking.
  insert into public.work_item_resource_assignments (organization_id, work_item_id, resource_id, created_by)
  select p_organization_id, v_item, rid, v_actor
    from unnest(v_resources) as rid;

  if v_type.booking_price_item_id is not null then
    perform public.add_work_item_priced_line(v_item, v_type.booking_price_item_id, 1);
  end if;

  -- **The questions the business asked, answered in the same transaction.** The visitor names a
  -- revision and answers; the form is the type's own and is never theirs to name. A form that is
  -- not currently accepting responses (archived, or nothing published) asks nothing, so a booking
  -- is never held hostage to a form somebody has since archived. If it *is* open the answers are
  -- required here -- a caller that skips them is told the booking changed, as is one that sends
  -- answers to a booking that no longer asks. A stale revision or an invalid answer raises inside
  -- this function and takes the work item, its resources and its price line with it: there is no
  -- booking without the answers it asked for, and no answers without the booking.
  v_intake_open := v_type.booking_intake_form_id is not null and exists (
    select 1 from public.forms f
     where f.organization_id = p_organization_id and f.id = v_type.booking_intake_form_id
       and f.archived_at is null and f.current_published_revision_id is not null);

  if v_intake_open then
    if p_intake_revision_id is null then
      raise exception 'this booking has changed since it was opened' using errcode = 'GD002';
    end if;
    perform app.record_form_submission(
      p_organization_id, v_type.booking_intake_form_id, p_intake_revision_id,
      coalesce(p_intake_answers, '{}'::jsonb), 'booking', v_actor, v_customer, v_item);
  elsif p_intake_revision_id is not null or p_intake_answers is not null then
    raise exception 'this booking has changed since it was opened' using errcode = 'GD002';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_item, 'work_item.booked',
     jsonb_build_object(
       'title', v_type.name,
       'customer_id', v_customer,
       'resource_ids', to_jsonb(v_resources),
       'starts_at', p_starts_at
     ));

  return v_item;
end;
$fn$;

revoke all on function public.create_booking(uuid, uuid, jsonb, timestamptz, text, text, text, uuid, jsonb) from public;
grant execute on function public.create_booking(uuid, uuid, jsonb, timestamptz, text, text, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading it, from both directions
-- ---------------------------------------------------------------------------

-- What a visitor is asked, for one bookable type of the business they are bound to: the published
-- revision, or null when the type asks nothing (or what it asked is no longer published). No
-- organization argument: the scope is the caller's own binding.
create function public.booking_intake_available(p_type_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.form_projection(t.booking_intake_form_id)
    from public.work_item_types t
   where t.id = p_type_id
     and t.organization_id = app.current_external_tenant()
     and t.booking_status_id is not null;
$fn$;
revoke all on function public.booking_intake_available(uuid) from public;
grant execute on function public.booking_intake_available(uuid) to authenticated;

-- Which response belongs to this booking, for a person who may read responses (the same authority
-- as the responses screen).
create function public.work_item_intake(p_organization_id uuid, p_work_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
      'submissionId', s.id, 'formId', s.form_id, 'formName', f.name, 'submittedAt', s.submitted_at,
      'revisionId', s.form_revision_id, 'revisionNumber', r.revision_number,
      'definition', r.definition, 'answers', s.answers)
    into v_result
    from public.form_submissions s
    join public.forms f on f.organization_id = s.organization_id and f.id = s.form_id
    join public.form_revisions r on r.organization_id = s.organization_id and r.form_id = s.form_id and r.id = s.form_revision_id
   where s.organization_id = p_organization_id and s.booking_work_item_id = p_work_item_id;
  return v_result;
end;
$fn$;
revoke all on function public.work_item_intake(uuid, uuid) from public;
grant execute on function public.work_item_intake(uuid, uuid) to authenticated;

-- The responses screen says which booking a response came from, so a person reading one can reach
-- the other. Same function as before with one more key.
create or replace function public.list_form_submissions(p_organization_id uuid, p_form_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not exists (select 1 from public.forms where organization_id = p_organization_id and id = p_form_id) then
    return null;
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.form_submissions
               where organization_id = p_organization_id and form_id = p_form_id),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'submittedAt', s.submitted_at, 'revisionId', s.form_revision_id,
        'source', s.source, 'answers', s.answers,
        'customerId', s.customer_id, 'customerName', c.name,
        'bookingWorkItemId', s.booking_work_item_id) order by s.submitted_at desc)
      from (select * from public.form_submissions
             where organization_id = p_organization_id and form_id = p_form_id
             order by submitted_at desc limit v_limit) s
      left join public.customers c on c.organization_id = s.organization_id and c.id = s.customer_id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.revision_number, 'definition', r.definition))
      from public.form_revisions r
      where r.organization_id = p_organization_id and r.form_id = p_form_id
        and r.id in (select form_revision_id from public.form_submissions
                      where organization_id = p_organization_id and form_id = p_form_id)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$fn$;

-- A booking-linked response, like a portal one, already knows who it is about: the booking found or
-- made that customer in the same transaction. Rewriting it afterwards would let the answers and the
-- booking they belong to name different people.
create or replace function public.link_form_submission_customer(p_organization_id uuid, p_submission_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_source text;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select source into v_source from public.form_submissions where organization_id = p_organization_id and id = p_submission_id for update;
  if v_source is null then raise exception 'that response does not exist in this organization' using errcode = 'GD001'; end if;
  if v_source = 'portal' then raise exception 'a portal response already belongs to the customer who sent it' using errcode = 'GD001'; end if;
  if v_source = 'booking' then raise exception 'a booking response already belongs to the customer who booked' using errcode = 'GD001'; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where organization_id = p_organization_id and id = p_customer_id) then
    raise exception 'that customer does not exist in this organization' using errcode = 'GD001';
  end if;
  update public.form_submissions set customer_id = p_customer_id
   where organization_id = p_organization_id and id = p_submission_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form_submission', p_submission_id,
          case when p_customer_id is null then 'form_submission.customer_unlinked' else 'form_submission.customer_linked' end,
          jsonb_build_object('customer_id', p_customer_id));
end;
$fn$;
