-- Vertical two, and the smallest whole version of it: a customer has a stage, a call is a row,
-- and how a call went is a word this business chose.
--
-- **Why the dialer and the pipeline arrive together rather than as two modules.** A pipeline
-- with no calls is a list somebody maintains by hand, and calls with no pipeline are a log
-- nobody reads twice. What makes either worth switching on is the loop between them: dial,
-- record how it went, move the stage, dial again tomorrow. Two modules would let a business buy
-- half a loop, and the half would look broken rather than smaller.
--
-- **Three of the four things here are words rather than mechanism**, which is the part that
-- keeps this general. The stage names, the outcome names and the note are the tenant's; the
-- platform supplies a place to put them, a direction, and the provider's own account of what
-- happened to the line. `docs/constraints.md` D6 is the rule and this is its second application:
-- what the business calls a thing is data, and only the code performing an operation is
-- vocabulary the platform owns.
--
-- **A lead is a state of a customer, not a second kind of person.** `constraints.md` wrote that
-- down before anything called for it, and this is the caller. There is no `leads` table here and
-- there must never be one: the entity is the person or company, and *lead*, *prospect* and
-- *customer* are stages of one relationship. The two questions that entry left open are answered
-- by this migration -- a staged customer is an ordinary customer in the ordinary list, and a work
-- item may reference one, because `work_items.customer_id` already does and nothing here narrows
-- it.

-- ---------------------------------------------------------------------------
-- Two capabilities
-- ---------------------------------------------------------------------------

-- **`customer.update` is the one this repository has been missing since M1**, and it is not a
-- reception feature -- it is the kernel finishing a sentence it started. `customers` shipped with
-- `grant select, insert` and nothing else, so a customer could be created and never corrected: a
-- typo in a phone number was permanent, and a business whose customer changed address had no path
-- at all. Nothing noticed for eight milestones because the businesses built here create customers
-- and then work on their jobs. A business that *works the customer* rather than the job finds it
-- on the first afternoon.
--
-- **`call.place` is a spend and a disclosure**, which is the same reason `assistant.ask` is a
-- capability: placing a call costs money and puts this business's number in front of somebody.
-- Both are decisions a business takes deliberately about who on the floor may do it.
--
-- There is deliberately no capability for *reading* a call. Reading is scoped by tenancy
-- everywhere in this platform and capability-scoped nowhere, and a recording -- which is the
-- thing that might genuinely deserve a narrower answer -- does not exist yet. When it does, it
-- gets that argument on its own merits rather than inheriting one made here.
alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'customer.update',
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
    'automation.manage',
    'configuration.propose',
    'assistant.ask',
    'report.read',
    'report.manage',
    'call.place'
  ]::text[]);

-- Whoever may write a customer down may correct one. Any other answer would mean a business
-- where the person taking details cannot fix them, which is not a policy anybody chose -- it is
-- what the absence of this capability has meant in practice.
update public.roles
   set capabilities = capabilities || array['customer.update']::text[]
 where 'customer.create' = any (capabilities)
   and not ('customer.update' = any (capabilities));

-- Onto whoever runs the business, the same answer `assistant.ask` and `automation.manage` gave.
-- A floor that wants its whole team dialling grants it to them, which is one checkbox and a
-- decision somebody made on purpose.
update public.roles
   set capabilities = capabilities || array['call.place']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('call.place' = any (capabilities));

-- ---------------------------------------------------------------------------
-- customer_stages -- where a relationship has got to, in the tenant's words
-- ---------------------------------------------------------------------------

-- Deliberately the same shape as `work_item_statuses` and deliberately not the same table. A
-- status describes a piece of work and a stage describes a relationship; a business with a
-- seven-step sales pipeline and a two-step job board is one business, and folding them together
-- would make its board columns appear in its pipeline.
--
-- **No transitions, and that is a decision rather than an omission.** Work items have a
-- transition graph because a job that jumps from *booked* to *invoiced* has skipped something
-- that costs money. A relationship has no such rule -- a lead that goes cold and comes back
-- warm moves backwards, and a business that wants to forbid that has not asked. `constraints.md`
-- I13 covers the case where the absence would be dangerous, and this is not it.
--
-- **The platform seeds none**, exactly as it seeds no working week and no starter catalogue. A
-- business that has configured no stages has customers with no stage, which is the honest
-- reading of *it has said nothing*.
create table public.customer_stages (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 64),

  -- Where it sits on the board. Not unique: two stages sharing a position is a display question
  -- with an obvious tiebreak, and a uniqueness constraint here would make reordering a puzzle
  -- of temporary values rather than two updates.
  position        integer     not null default 0 check (position >= 0),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.customer_stages is
  'What this business calls the stages of a relationship -- prospect, qualified, customer, dormant. Its words, its order, its length. The platform seeds none. See constraints.md D6.';

-- I2: tenant id leads.
create unique index customer_stages_org_name_unique
  on public.customer_stages (organization_id, lower(name));

create index customer_stages_org_position_idx
  on public.customer_stages (organization_id, position, created_at);

-- The target of the composite foreign key below, which is what makes "a customer's stage belongs
-- to the same business" a database guarantee rather than something every caller remembers (I18).
alter table public.customer_stages
  add constraint customer_stages_org_id_unique unique (organization_id, id);

alter table public.customer_stages enable row level security;
alter table public.customer_stages force row level security;

create policy customer_stages_select on public.customer_stages
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- `field.manage` rather than a new capability, and for the reason that capability already
-- carries: naming the vocabulary this business records things in is one job, whether the thing
-- being named is a custom field, a board column or a stage. A third capability would be a third
-- checkbox for one decision.
create policy customer_stages_insert on public.customer_stages
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

create policy customer_stages_update on public.customer_stages
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  )
  with check (organization_id in (select app.current_tenant_ids()));

grant select on public.customer_stages to authenticated;
grant insert (organization_id, name, position, created_by) on public.customer_stages to authenticated;
grant update (name, position) on public.customer_stages to authenticated;

-- ---------------------------------------------------------------------------
-- customers.stage_id
-- ---------------------------------------------------------------------------

-- Nullable, and it stays nullable permanently. A business that never switches reception on has
-- customers with no stage and is not missing anything; a business that does has customers it
-- has not staged yet. Both are ordinary, and a default would be the platform choosing a first
-- stage on behalf of a business that has not named one.
alter table public.customers add column stage_id uuid;

alter table public.customers
  add constraint customers_stage_same_org
  foreign key (organization_id, stage_id)
  references public.customer_stages (organization_id, id)
  on delete set null;

-- Deleting a stage releases the customers on it rather than taking them with it (`set null`
-- above). The opposite would mean renaming a board column by deleting and re-adding it silently
-- destroyed a book of business.
create index customers_org_stage_idx
  on public.customers (organization_id, stage_id)
  where stage_id is not null;

-- ---------------------------------------------------------------------------
-- Editing a customer
-- ---------------------------------------------------------------------------


create policy customers_update on public.customers
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'customer.update')
  )
  with check (organization_id in (select app.current_tenant_ids()));

-- **By column, and the omissions are the point.** `organization_id` is absent so a customer can
-- never be moved between businesses by an update; `created_by` is absent because who wrote a row
-- down is history rather than configuration; `id` is absent for the obvious reason. CLAUDE.md
-- records that a table-wide update grant is a promise about every column this table will ever
-- have, and that the promise has been broken here twice.
grant update (name, email, phone, custom, stage_id) on public.customers to authenticated;

-- One function so that validating the custom payload, writing the row and recording the event
-- happen together or not at all. The same shape `create_customer` has, for the same reason: a
-- caller that could do two of the three would eventually do two of the three.
--
-- **Every argument is the new value, including the ones that did not change.** A partial update
-- would need a way to say *leave this alone* that is distinguishable from *set this to null*,
-- and the two forms a screen can send are a whole record or a patch. A whole record is what a
-- form has.
create function public.update_customer(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_custom          jsonb,
  p_stage_id        uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_before uuid;
begin
  if v_actor is null then
    raise exception 'update_customer requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Read the old stage before writing, so the event can say what moved. Under the caller's own
  -- rights: a customer they cannot select is one they cannot update either, and the update
  -- below would match nothing anyway.
  select c.stage_id into v_before
    from public.customers c
   where c.organization_id = p_organization_id
     and c.id = p_customer_id;

  update public.customers
     set name     = p_name,
         email    = p_email,
         phone    = p_phone,
         custom   = coalesce(p_custom, '{}'::jsonb),
         stage_id = p_stage_id
   where organization_id = p_organization_id
     and id = p_customer_id;

  if not found then
    -- Indistinguishable from "no such customer" on purpose, exactly as `getCustomer` is. A
    -- caller able to tell a refusal from an absence has been told this row exists.
    raise exception 'no such customer here, or not yours to change'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'customer', p_customer_id, 'customer.updated',
     jsonb_build_object('name', p_name));

  -- A separate fact from the edit, and separately readable. Somebody correcting a phone number
  -- and somebody moving a deal to *qualified* are two different things to find on a timeline,
  -- and folding them into one action would make the second unfindable.
  if v_before is distinct from p_stage_id then
    insert into public.events
      (organization_id, actor_id, entity_type, entity_id, action, payload)
    values
      (p_organization_id, v_actor, 'customer', p_customer_id, 'customer.stage_changed',
       jsonb_build_object('from_stage_id', v_before, 'to_stage_id', p_stage_id));
  end if;
end;
$fn$;

revoke all on function public.update_customer(uuid, uuid, text, text, text, jsonb, uuid) from public;
grant execute on function public.update_customer(uuid, uuid, text, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- call_outcomes -- how it went, in the tenant's words
-- ---------------------------------------------------------------------------

-- **This table is the whole argument against porting a dialer's schema across.** Every system
-- that has solved this before ships a fixed list -- no answer, voicemail, wrong number,
-- interested, qualified, appointment booked -- baked into a check constraint. That list is one
-- business's sales process, and the next business's is different in ways that matter to it and
-- to nobody else. D6 is the rule; this is the row it becomes.
--
-- **`reached` is the one platform fact on it**, and it is here because it is the only thing the
-- platform ever needs to know about an outcome: did a conversation happen. A business's own
-- words cannot answer that -- *gatekeeper* and *left voicemail* are both failures to connect and
-- neither says so in its name -- and a report counting connect rate has to ask somebody. It asks
-- the business, once, when the outcome is named.
create table public.call_outcomes (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 64),
  position        integer     not null default 0 check (position >= 0),

  -- Did somebody actually speak to somebody. The tenant answers it; the platform only counts it.
  reached         boolean     not null default false,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.call_outcomes is
  'What this business calls the ways a call can go. Its words and its list; the only platform fact on the row is whether the outcome counts as having reached somebody. See constraints.md D6.';

create unique index call_outcomes_org_name_unique
  on public.call_outcomes (organization_id, lower(name));

alter table public.call_outcomes
  add constraint call_outcomes_org_id_unique unique (organization_id, id);

alter table public.call_outcomes enable row level security;
alter table public.call_outcomes force row level security;

create policy call_outcomes_select on public.call_outcomes
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy call_outcomes_insert on public.call_outcomes
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

create policy call_outcomes_update on public.call_outcomes
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  )
  with check (organization_id in (select app.current_tenant_ids()));

grant select on public.call_outcomes to authenticated;
grant insert (organization_id, name, position, reached, created_by) on public.call_outcomes to authenticated;
grant update (name, position, reached) on public.call_outcomes to authenticated;

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------

-- **A call belongs to a customer and never floats free.** An inbound call from a number nobody
-- recognises is a real thing and it is not this row: it becomes one the moment somebody decides
-- who it was from, and until then it is provider state rather than business record. Making
-- `customer_id` nullable now would buy a column with no caller and an empty screen nobody can
-- explain (I18's own reasoning, one level up).
--
-- **`status` is platform vocabulary and `outcome_id` is the tenant's**, and the pair is the
-- distinction this table exists to keep. *The line rang and nobody picked up* is a fact about
-- the telephone network that every business on earth agrees on. *That was a gatekeeper* is a
-- judgement one business makes in its own words. Systems that store one column for both end up
-- unable to report on either.
create table public.calls (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  customer_id     uuid        not null,

  direction       text        not null check (direction in ('outbound', 'inbound')),

  -- What the network did. The provider's account, normalised to the six states every provider
  -- reports and no more -- a seventh that only one vendor emits would be that vendor's
  -- vocabulary arriving through the back door (I15).
  status          text        not null default 'ringing'
                              check (status in (
                                'ringing', 'in_progress', 'completed',
                                'failed', 'no_answer', 'busy'
                              )),

  -- E.164, both ends, checked the same way `nextfund-portal` checks it and for the same reason:
  -- a number without a country is a number that dials somewhere else.
  from_number     text        not null check (from_number ~ '^\+[1-9][0-9]{7,14}$'),
  to_number       text        not null check (to_number ~ '^\+[1-9][0-9]{7,14}$'),

  -- The provider's own id for this call, so a later callback can find the row it belongs to.
  -- Null for a call recorded by hand, which is what a business with no telephony configured has.
  external_id     text        check (external_id is null or length(btrim(external_id)) between 1 and 128),

  -- How it went, in this business's words. Null until somebody says.
  outcome_id      uuid,

  -- What the person heard, in their own words. The one free-text field, and the reason a floor
  -- tolerates a CRM at all.
  note            text        not null default '',

  started_at      timestamptz not null default now(),
  ended_at        timestamptz,

  -- Seconds, from the provider or from a person. Not derived from the two timestamps above: a
  -- call answered after forty seconds of ringing lasted less than the gap between them, and the
  -- provider is the only thing that knows the difference.
  duration_seconds integer    check (duration_seconds is null or duration_seconds >= 0),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- I18: the customer and the outcome both belong to the same business as the call.
  constraint calls_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade,

  constraint calls_outcome_same_org
    foreign key (organization_id, outcome_id)
    references public.call_outcomes (organization_id, id) on delete set null,

  constraint calls_ended_after_started
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.calls is
  'One call, outbound or inbound, attached to the customer it was with. status is what the network did; outcome_id is what this business calls the result.';

-- The two queries this table has: one customer's calls, and the floor's day. Both lead with
-- the tenant id (I2).
create index calls_org_customer_started_idx
  on public.calls (organization_id, customer_id, started_at desc);

create index calls_org_started_idx
  on public.calls (organization_id, started_at desc);

-- A provider's id identifies one call within one business. Partial because a call logged by
-- hand has none, and Postgres treats each null as distinct anyway -- saying so explicitly marks
-- the omission as intended.
create unique index calls_org_external_id_unique
  on public.calls (organization_id, external_id)
  where external_id is not null;

alter table public.calls enable row level security;
alter table public.calls force row level security;

-- Tenant-wide, like every other operational record here. A floor where a rep cannot see that a
-- colleague already called this business today is a floor that calls it twice.
create policy calls_select on public.calls
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy calls_insert on public.calls
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'call.place')
  );

-- Whoever may place a call may say how it went. The row is finished afterwards rather than at
-- the moment of dialling, because at the moment of dialling nobody knows anything yet.
create policy calls_update on public.calls
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'call.place')
  )
  with check (organization_id in (select app.current_tenant_ids()));

-- No delete policy. A call that happened happened, and the only reason to remove one is to make
-- the record say something else -- the same answer `agent_runs` and `automation_runs` give.

grant select on public.calls to authenticated;
grant insert (organization_id, customer_id, direction, status, from_number, to_number,
              external_id, started_at, created_by)
  on public.calls to authenticated;

-- **What is writable afterwards, and what is not.** The two numbers, the direction and the
-- customer are what the call *was* and can never be edited into something else. What a person
-- learns after the fact -- how it went, what was said, how long it lasted, how it ended -- is
-- what this grant covers.
grant update (status, outcome_id, note, ended_at, duration_seconds)
  on public.calls to authenticated;
