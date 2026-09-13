-- A stage change and a call outcome get their own narrow doors.
--
-- **Why these two, and why now.** `apps/api/app/domains` is a new caller of this schema: a
-- FastAPI-style command, running under the operator's own forwarded token exactly as `app/ai`
-- already does (D17, D34), rather than a Postgres role of its own. It needs an RPC that does
-- exactly one thing and answers with exactly the row it wrote, the same shape `open_call` and
-- `set_calling_number` already are. Neither existing write fits: `update_customer` moves a
-- stage only as a side effect of correcting the whole record, and a call's outcome has never had
-- a function at all -- `apps/web` writes it with a bare `update calls set ...` under RLS.
--
-- **Nothing here removes anything.** `update_customer`'s `p_stage_id` argument still moves a
-- stage when a person corrects a customer's details in one sitting (`EditCustomerForm`'s own
-- documented reason: "one record and one act"). This migration adds the other act -- moving a
-- customer along the pipeline on its own, from a board rather than a detail screen -- and gives
-- it a door of its own rather than bending the first door to fit a second act it was never shaped
-- for. Both remain the one write path for what each is: `update_customer` cannot be reached to
-- move a stage without also supplying every other field, and this function cannot touch a name,
-- an email or a phone number at all.

-- ---------------------------------------------------------------------------
-- change_customer_stage -- moving a customer along the pipeline, on its own
-- ---------------------------------------------------------------------------

-- Security invoker, like every narrow function on this table: it adds no authority of its own,
-- and `customers_update` (capability `customer.update`) is what actually decides whether the
-- update happens. A caller who could not move this customer under that policy gets the same
-- "no such customer" refusal `update_customer` already gives, for the same reason -- a caller
-- able to tell a refusal from an absence has been told the row exists.
create function public.change_customer_stage(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_stage_id        uuid
)
returns public.customers
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_before uuid;
  v_row    public.customers;
begin
  if v_actor is null then
    raise exception 'change_customer_stage requires an authenticated caller'
      using errcode = '42501';
  end if;

  select c.stage_id into v_before
    from public.customers c
   where c.organization_id = p_organization_id
     and c.id = p_customer_id;

  update public.customers
     set stage_id = p_stage_id
   where organization_id = p_organization_id
     and id = p_customer_id
   returning * into v_row;

  if not found then
    raise exception 'no such customer here, or not yours to change'
      using errcode = '42501';
  end if;

  -- Silent when the board re-submits the column a card is already in -- a no-op write is not a
  -- move, and `customer.stage_changed` says something happened.
  if v_before is distinct from p_stage_id then
    insert into public.events
      (organization_id, actor_id, entity_type, entity_id, action, payload)
    values
      (p_organization_id, v_actor, 'customer', p_customer_id, 'customer.stage_changed',
       jsonb_build_object('from_stage_id', v_before, 'to_stage_id', p_stage_id));
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.change_customer_stage(uuid, uuid, uuid) from public;
grant execute on function public.change_customer_stage(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_call_outcome -- how it went, written and told to the timeline together
-- ---------------------------------------------------------------------------

-- The two writes `recordCallOutcome` (TypeScript) performed one after another -- the `calls`
-- update and the `events` insert -- as one transaction instead. `constraints.md`'s own rule on
-- transactions (a command needing atomic multi-row writes gets a database function rather than
-- two stateless requests) applied to this schema's own domain layer before it ever applied to
-- Python: two network round trips from `apps/web` already had this gap, undetected because
-- nothing between them could fail independently in practice. A Python caller one more hop away
-- is exactly the caller that would notice.
create function public.record_call_outcome(
  p_organization_id  uuid,
  p_call_id          uuid,
  p_outcome_id       uuid,
  p_note             text,
  p_duration_seconds integer,
  p_status           text
)
returns public.calls
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.calls;
begin
  if v_actor is null then
    raise exception 'record_call_outcome requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.calls
     set outcome_id       = p_outcome_id,
         note              = coalesce(p_note, ''),
         duration_seconds  = p_duration_seconds,
         status            = coalesce(p_status, 'completed'),
         ended_at          = now()
   where organization_id = p_organization_id
     and id = p_call_id
   returning * into v_row;

  if not found then
    -- The same ambiguous refusal `recordCallOutcome` raised as a `DomainError` -- "That call is
    -- not yours to write up" -- now raised where the write itself happens.
    raise exception 'that call is not yours to write up'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'customer', v_row.customer_id, 'call.wrapped_up',
     jsonb_build_object('call_id', v_row.id, 'outcome_id', p_outcome_id));

  return v_row;
end;
$fn$;

revoke all on function public.record_call_outcome(uuid, uuid, uuid, text, integer, text) from public;
grant execute on function public.record_call_outcome(uuid, uuid, uuid, text, integer, text) to authenticated;
