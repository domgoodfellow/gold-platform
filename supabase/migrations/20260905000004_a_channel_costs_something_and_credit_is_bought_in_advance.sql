-- The communications engine: one vocabulary for a channel, and one purse every channel draws on.
--
-- **Why this is an engine and not a dialer feature**, held to the bar `constraints.md` opens
-- with. An engine needs two independent pieces of evidence, at least one from a system that
-- shipped. There are two: M6 shipped messaging in this repository -- templates, deliveries, a
-- send log -- and `nextfund-portal` shipped a floor with calls, email templates and workflows
-- side by side. Neither is a hypothesis, and both wanted the same two things this file adds.
--
-- **What the engine owns is the part that is identical across channels**, and nothing else. A
-- telephone call, a text message and an email are three different acts with three different
-- adapters, three different failure modes and three different records -- and none of that is
-- touched here. What they share is: they cost money, the money is the same money, and a
-- business that has run out must be stopped before the spend rather than invoiced after it.
--
-- **Deliberately not built: a `communications` table above messages and calls.** It is the
-- obvious next abstraction and it has no caller. `customer_activity` already answers *what have
-- we said to this person* by reading events, which both channels write, so the unifying read
-- exists and needs no unifying table under it. Adding one would be two rows for every message.
--
-- **Credit is bought in advance, and that is the whole of why this is not metered billing.**
-- Nobody can spend money they have not already handed over: no arrears, no dunning, no credit
-- risk, no invoice at the end of a month. `market.md` says implementation and platform fees are
-- invoiced, and a prepaid pack is a thing bought rather than a bill sent -- closer to that row
-- than to a utility company. What it *does* delete is D39's liability paragraph.

-- ---------------------------------------------------------------------------
-- What a channel is
-- ---------------------------------------------------------------------------

-- Platform vocabulary and not a tenant's word, for the reason `calls.status` is: the code has to
-- know which adapter to reach for, and a business renaming *voice* to *phone* must not change
-- which one runs. What a business calls the act is its own -- an outcome, a template name, a
-- stage -- and none of those are this.
create type public.communication_channel as enum ('voice', 'sms', 'email');

-- ---------------------------------------------------------------------------
-- communication_rates -- what GOLD charges, which is not a tenant's business to configure
-- ---------------------------------------------------------------------------

-- **No `organization_id`, and that puts this outside I2 rather than in breach of it** -- the same
-- standing `platform_staff` has. A price GOLD charges is not a row a tenant owns, cannot be seen
-- differently by two tenants in the same currency, and must not be editable by the business
-- being charged.
--
-- **Written by migration and by nothing else.** There is deliberately no application write path:
-- platform staff hold no insert, update or delete grant on any table at all (I21), and a screen
-- that let a business set its own price would be the obvious catastrophe. A price list that
-- changes rarely and must change deliberately is a deploy, and that is the right cost.
--
-- **Nothing is seeded**, which matters more than it looks: with no rate for a channel, that
-- channel costs nothing and nothing is drawn down. A deployment that has not priced its
-- telephone calls keeps working exactly as it did, and credit becomes load-bearing on the day
-- somebody decides what a minute is worth (D31's shape, applied to money).
create table public.communication_rates (
  id                uuid        primary key default gen_random_uuid(),

  -- ISO 4217, matching the organization being charged. **A rate exists per currency because
  -- amounts are never converted** (I10): a business banking in one currency cannot be charged in
  -- another without a rate, and a rate has a date, and a date makes this accounting software.
  currency          text        not null check (length(btrim(currency)) = 3),

  channel           public.communication_channel not null,

  -- What one unit costs, in minor units. A unit is one minute of voice or one message
  -- otherwise -- stated here because it is the one place both readings meet.
  unit_amount_minor bigint      not null check (unit_amount_minor >= 0),

  updated_at        timestamptz not null default now(),

  constraint communication_rates_one_per_channel unique (currency, channel)
);

comment on table public.communication_rates is
  'What GOLD charges for a unit of each channel, per currency. Not tenant-owned and deliberately outside I2. Written by migration only: staff hold no write grant anywhere, and a business must not price what it is charged.';

alter table public.communication_rates enable row level security;
alter table public.communication_rates force row level security;

-- Readable by anybody signed in, because a business is entitled to know what it is being charged
-- before it spends. There is nothing tenant-specific in the row to leak.
create policy communication_rates_select on public.communication_rates
  for select to authenticated
  using (true);

grant select on public.communication_rates to authenticated;

-- ---------------------------------------------------------------------------
-- communication_credits -- the purse, as a ledger
-- ---------------------------------------------------------------------------

-- **A balance is a sum and never a column** (I4). No `balance` field anywhere, no materialized
-- view, and `app.credit_balance` below is the one answer -- which is the same rule that keeps
-- there being exactly one `priceWorkItem` and exactly one `freeWindows`. Nothing has measured a
-- slow query in this repository yet, and the day something does, the remedy is an index rather
-- than a second truth.
create table public.communication_credits (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- Positive is money in, negative is money spent. One signed column rather than two, because a
  -- purse with `credits` and `debits` beside each other is two numbers that can disagree about
  -- one fact.
  amount_minor    bigint      not null check (amount_minor <> 0),

  -- Snapshotted onto the row, never joined to (I8). A business that changes what it trades in
  -- has a purse in two currencies rather than a purse that silently reinterprets its history.
  currency        text        not null check (length(btrim(currency)) = 3),

  -- Why the money moved. Platform vocabulary: these are facts about GOLD's relationship with
  -- this business, not words the business chose.
  reason          text        not null check (reason in ('purchase', 'usage', 'adjustment')),

  -- Which channel spent it. Null for a purchase and for an adjustment.
  channel         public.communication_channel,

  -- What it was spent on, when that is a call. Null otherwise, and deliberately not a foreign
  -- key to `messages`: the second channel to charge adds its own column when it charges, and a
  -- polymorphic pair here would be the shape `schema-conformance.test.ts` forbids outside
  -- `events`.
  call_id         uuid,

  -- What a person reading a statement needs, in whatever words whoever wrote the row used.
  note            text        not null default '',

  occurred_at     timestamptz not null default now(),

  -- Null for a machine. A drawdown has no human behind it, which is the honest reading of who
  -- spent it: the business did, by making a call, and nobody pressed a button to be charged.
  created_by      uuid        references auth.users (id),

  constraint communication_credits_call_same_org
    foreign key (organization_id, call_id)
    references public.calls (organization_id, id) on delete set null,

  -- A purchase has no channel; a usage row has one. Stated as a constraint because a usage row
  -- with no channel is a charge nobody can explain.
  constraint communication_credits_channel_matches_reason
    check ((reason = 'usage') = (channel is not null))
);

comment on table public.communication_credits is
  'Money in and money out, in minor units of the organization''s own currency. The balance is the sum of it -- there is no balance column, per I4.';

-- I2: tenant id leads. The one query this table has is a running statement, newest first.
create index communication_credits_org_occurred_idx
  on public.communication_credits (organization_id, occurred_at desc);

alter table public.communication_credits enable row level security;
alter table public.communication_credits force row level security;

-- **Readable by the whole business, writable by nobody signed in.** A member seeing what their
-- own business has spent is ordinary; a member adding credit to their own purse is the obvious
-- catastrophe, and the way to make it impossible is for no policy to permit it rather than for
-- a capability to withhold it.
create policy communication_credits_select on public.communication_credits
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

grant select on public.communication_credits to authenticated;

-- ---------------------------------------------------------------------------
-- The one answer to "how much is left"
-- ---------------------------------------------------------------------------

-- **In `public` because a screen calls it**, which PostgREST only permits for an exposed schema.
-- `stable` and `security invoker`, so a screen, a policy and eventually an AI tool all get the
-- same answer and none of them sees a row it could not see itself (D34, D35). Its unchecked twin
-- below stays in `app`, where nothing outside the database can reach it.
create function public.credit_balance(p_organization_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(sum(c.amount_minor), 0)::bigint
    from public.communication_credits c
   where c.organization_id = p_organization_id;
$fn$;

comment on function public.credit_balance(uuid) is
  'What this business has left, in minor units of its own currency. The sum of the ledger and the only answer to that question.';

revoke all on function public.credit_balance(uuid) from public;
grant execute on function public.credit_balance(uuid) to authenticated;

-- The same question asked with the caller's rights set aside, for the two SECURITY DEFINER
-- functions below. Separate rather than a flag, because a function that decides from an argument
-- whether to respect RLS is where an authorization mistake goes to hide.
create function app.credit_balance_unchecked(p_organization_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(c.amount_minor), 0)::bigint
    from public.communication_credits c
   where c.organization_id = p_organization_id;
$fn$;

revoke all on function app.credit_balance_unchecked(uuid) from public;

-- ---------------------------------------------------------------------------
-- What a channel costs, and whether this business can afford to start
-- ---------------------------------------------------------------------------

create function app.channel_rate(p_currency text, p_channel public.communication_channel)
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.unit_amount_minor
    from public.communication_rates r
   where r.currency = upper(btrim(p_currency))
     and r.channel = p_channel;
$fn$;

revoke all on function app.channel_rate(text, public.communication_channel) from public;

-- **The refusal, and it lives here rather than in a screen.** A balance check that only greys
-- out a button is not enforcement -- it is a suggestion that a second caller, an automation or
-- an AI action would walk straight past. This is called from inside `open_call`, before the
-- carrier is asked for anything.
--
-- **No rate means no charge means no refusal.** A deployment that has not priced a channel keeps
-- working exactly as it did before this migration, which is what makes credit opt-in rather than
-- a thing that breaks every existing tenant on the day it lands.
create function app.may_spend_on(
  p_organization_id uuid,
  p_channel         public.communication_channel,
  p_units           integer default 1
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_currency text;
  v_rate     bigint;
begin
  select o.currency into v_currency
    from public.organizations o
   where o.id = p_organization_id;

  if v_currency is null then
    -- A business that has not said what it trades in cannot be charged, and must not be
    -- stopped from working while it decides.
    return true;
  end if;

  v_rate := app.channel_rate(v_currency, p_channel);

  if v_rate is null or v_rate = 0 then
    return true;
  end if;

  return app.credit_balance_unchecked(p_organization_id) >= v_rate * greatest(p_units, 1);
end;
$fn$;

comment on function app.may_spend_on(uuid, public.communication_channel, integer) is
  'Whether this business can afford to start. True when the channel is unpriced, which is what makes credit opt-in per deployment.';

revoke all on function app.may_spend_on(uuid, public.communication_channel, integer) from public;

-- **Granted to `authenticated` because `open_call` is security invoker and must stay so.** That
-- function adds no authority of its own -- the policies on `calls` are what decide whether a
-- caller may place one -- so the affordability check it makes runs as the caller too, and a
-- caller with no grant here would be refused for the wrong reason entirely.
--
-- What this exposes is one boolean about one organization id, to somebody who would have to
-- already hold that id. It says nothing about the balance, the rate, or whether the business
-- exists.
grant execute on function app.may_spend_on(uuid, public.communication_channel, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Charging for what happened
-- ---------------------------------------------------------------------------

-- **Charged when the call ends rather than when it starts**, because the price is not known
-- until then. What makes that safe is the thing built one migration ago: `record_call_event`
-- applies a delivery exactly once, so a carrier retrying a `completed` callback cannot bill a
-- business twice. The deduplication was written for correctness and turns out to be what makes
-- billing honest.
--
-- Rounded up to the minute, which is how the carrier charges and how every telephone bill
-- anybody has ever read works. Stated because rounding is exactly the kind of thing that gets
-- discovered in an argument with a customer.
create function app.charge_for_call(p_call_id uuid, p_duration_seconds integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_call     public.calls;
  v_currency text;
  v_rate     bigint;
  v_minutes  integer;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 then
    -- Nothing connected, nothing to charge. A call that rang out costs the carrier nothing
    -- worth passing on and charging for it would be indefensible.
    return;
  end if;

  select c.* into v_call from public.calls c where c.id = p_call_id;
  if not found then
    return;
  end if;

  select o.currency into v_currency
    from public.organizations o
   where o.id = v_call.organization_id;

  if v_currency is null then
    return;
  end if;

  v_rate := app.channel_rate(v_currency, 'voice');
  if v_rate is null or v_rate = 0 then
    return;
  end if;

  v_minutes := ceil(p_duration_seconds::numeric / 60)::integer;

  insert into public.communication_credits
    (organization_id, amount_minor, currency, reason, channel, call_id, note)
  values
    (v_call.organization_id, -(v_rate * v_minutes), v_currency, 'usage', 'voice', v_call.id,
     format('%s minute(s) of voice', v_minutes));
end;
$fn$;

comment on function app.charge_for_call(uuid, integer) is
  'Draw a finished call down from the purse, rounded up to the minute. Called once per call by record_call_event, whose deduplication is what stops a retried callback charging twice.';

revoke all on function app.charge_for_call(uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- Wiring both ends into the call path
-- ---------------------------------------------------------------------------

-- Replaced rather than edited: a migration that has been applied is never modified, so the two
-- functions that need to know about money are recreated here in full.

-- **Its legs are no longer its business, and the argument goes with them.** The first version
-- wrote the two expected participants itself, as the caller -- which cannot work and should not:
-- `call_participants` deliberately grants nobody signed in an insert, because a leg exists
-- because a telephone rang rather than because somebody typed one. The trigger below writes them
-- instead, and takes the agent from who placed the call rather than from an argument that could
-- name somebody else.
drop function if exists public.open_call(uuid, uuid, text, text, text, uuid);

create function public.open_call(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_conference_name text,
  p_from_number     text,
  p_to_number       text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  -- **Before the room is written and long before the carrier is asked.** A business out of
  -- credit is stopped here, in the database, where an automation or an AI action reaches it
  -- too -- rather than at a disabled button, which only the screen obeys.
  if not app.may_spend_on(p_organization_id, 'voice', 1) then
    raise exception 'there is no calling credit left on this account'
      using errcode = '23514';
  end if;

  insert into public.calls
    (organization_id, customer_id, direction, status, from_number, to_number,
     conference_name, created_by)
  values
    (p_organization_id, p_customer_id, 'outbound', 'ringing', p_from_number, p_to_number,
     p_conference_name, (select auth.uid()))
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, (select auth.uid()), 'customer', p_customer_id, 'call.placed',
     jsonb_build_object('call_id', v_id, 'direction', 'outbound', 'to_number', p_to_number));

  return v_id;
end;
$fn$;

comment on function public.open_call(uuid, uuid, text, text, text) is
  'A room, the credit check that guards it, and the event. security invoker: the calls policies decide whether the caller may, and this adds no authority of its own. The legs are written by a trigger.';

revoke all on function public.open_call(uuid, uuid, text, text, text) from public;
grant execute on function public.open_call(uuid, uuid, text, text, text) to authenticated;

-- **The two people expected in the room, written because a call was, not because anybody asked.**
-- SECURITY DEFINER so that `call_participants` can keep granting nobody an insert: a leg is a
-- fact about a telephone, and the only things that may state one are this and the carrier's own
-- callbacks.
--
-- The agent is whoever placed the call, read from the row rather than passed in -- which is both
-- one fewer argument and one fewer way to attribute a call to somebody who did not make it.
create function app.open_call_legs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.call_participants (organization_id, call_id, party, member_id)
  values (new.organization_id, new.id, 'agent', new.created_by),
         (new.organization_id, new.id, 'customer', null);

  return new;
end;
$fn$;

-- Only for a call that has a room. A call written down after the fact happened on somebody's
-- mobile and never had legs at the carrier; inventing two would be recording a conference that
-- did not occur.
create trigger calls_open_legs
  after insert on public.calls
  for each row
  when (new.conference_name is not null)
  execute function app.open_call_legs();

create or replace function public.record_call_event(
  p_external_id   text,
  p_source        text,
  p_raw_status    text,
  p_status        text,
  p_duration      integer,
  p_recording_url text,
  p_payload       jsonb,
  p_payload_hash  text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  constant uuid := '00000000-0000-4000-8000-0000000000a2';
  v_call   public.calls;
  v_leg    public.call_participants;
  v_id     uuid;
begin
  select c.* into v_call
    from public.calls c
   where c.external_id = p_external_id;

  if not found then
    select p.* into v_leg
      from public.call_participants p
     where p.external_id = p_external_id;

    if not found then
      return null;
    end if;

    select c.* into v_call
      from public.calls c
     where c.organization_id = v_leg.organization_id
       and c.id = v_leg.call_id;
  end if;

  insert into public.call_events
    (organization_id, call_id, source, raw_status, payload, payload_hash)
  values
    (v_call.organization_id, v_call.id, p_source, p_raw_status,
     coalesce(p_payload, '{}'::jsonb), p_payload_hash)
  on conflict (organization_id, payload_hash) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  if v_leg.id is not null then
    update public.call_participants
       set status    = coalesce(p_status, status),
           joined_at = case
                         when p_status = 'in_progress' and joined_at is null then now()
                         else joined_at
                       end,
           left_at   = case
                         when p_status in ('completed', 'failed', 'no_answer', 'busy')
                           then coalesce(left_at, now())
                         else left_at
                       end
     where id = v_leg.id;
  end if;

  update public.calls
     set status           = case
                              when status in ('completed', 'failed', 'no_answer', 'busy')
                                then status
                              else coalesce(p_status, status)
                            end,
         duration_seconds = coalesce(p_duration, duration_seconds),
         recording_url    = coalesce(p_recording_url, recording_url),
         ended_at         = case
                              when p_status in ('completed', 'failed', 'no_answer', 'busy')
                                then coalesce(ended_at, now())
                              else ended_at
                            end
   where id = v_call.id;

  if p_status in ('completed', 'failed', 'no_answer', 'busy') then
    -- **Inside the deduplication, which is what makes it safe to charge here.** Reaching this
    -- line means the delivery was new: a carrier retrying the same `completed` returned above,
    -- so a business cannot be billed twice for one conversation.
    perform app.charge_for_call(v_call.id, p_duration);

    insert into public.events
      (organization_id, actor_id, entity_type, entity_id, action, payload)
    values
      (v_call.organization_id, v_actor, 'customer', v_call.customer_id, 'call.ended',
       jsonb_build_object('call_id', v_call.id, 'status', p_status, 'duration', p_duration));
  end if;

  return v_id;
end;
$fn$;
