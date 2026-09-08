-- Signing up asks two questions, and a business may not have said what it trades in.
--
-- **What a person does on the first screen is sign up, not found a tenant.** The screen they
-- met asked four things at once -- a business name, their own name, an IANA zone from a list of
-- every zone on earth, and a currency -- with the last two sitting beside the first two as
-- though they were the same kind of question. They are not. A name is something the person
-- came here holding; a currency is a fact about money that matters the first time money is
-- recorded, which is not now.
--
-- The rule this migration follows is the oldest one in form design: **remove any field that can
-- be derived elsewhere or collected later.** The zone can be derived -- the browser knows where
-- it is, and the screen shows what it derived rather than hiding it. The currency can be
-- collected later, and this migration is what makes "later" expressible.
--
-- **The previous behaviour was right about the rule and wrong about the moment.**
-- `20260830000001` raised on a null currency with the reasoning that "there is no neutral
-- currency, so a platform default would be the platform deciding what this business trades in".
-- That argument is correct and it is untouched: nothing here invents a currency. What it got
-- wrong is that refusing to *default* one is not the same as demanding one before the business
-- exists. The column carried `not null default 'EUR'`, so a business that never reached the
-- currency box was silently recorded as trading in euro -- the platform deciding, by a column
-- default, exactly what that raise existed to prevent one level up.
--
-- So `currency` becomes nullable, and null means **this business has not said**. That is the
-- same reading of silence operating hours already have: a business that has configured no hours
-- is treated as always open rather than as closed, because the platform does not answer for it.
-- The two functions that read this column and write an amount now refuse, in a sentence, rather
-- than failing on a not-null constraint somewhere below them.

-- ---------------------------------------------------------------------------
-- A currency a business has not chosen
-- ---------------------------------------------------------------------------

alter table public.organizations
  alter column currency drop default,
  alter column currency drop not null;

-- The shape check survives untouched: a CHECK on a null column passes, so `null` is admitted
-- and 'eur' still is not.
comment on column public.organizations.currency is
  'ISO 4217 code this business trades in, or null when it has not said. Never assumed by the platform, never defaulted, and snapshotted onto each amount (I10).';

-- ---------------------------------------------------------------------------
-- Founding, with one question fewer
-- ---------------------------------------------------------------------------

-- `p_currency` gains a default rather than leaving the signature, and the two doors are why.
-- Somebody at GOLD provisioning a business they have spoken to knows what it trades in and says
-- so; somebody signing up has not been asked. One creation path, two callers, and the argument
-- is optional for the one that does not hold the answer (D29).
create or replace function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Anonymous is a real session and a real `auth.uid()` -- that is the whole of D22's answer
  -- to question 2 -- and it is still not a person who may found a business. Coalesced because
  -- a null here must read as "not established anonymous", never as "not anonymous".
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_actor), true) then
    raise exception 'an anonymous session may not create an organization'
      using errcode = '42501';
  end if;

  -- **The raise that used to stand here is gone, and its rule is not.** It refused a null
  -- currency so the platform could not decide what a business trades in. It now travels with
  -- the write it protects: `create_price_book_item` and `record_work_item_cost` refuse, because
  -- that is the moment the answer is actually needed and the moment a person can be asked for
  -- it in context. Nothing between here and there invents one.
  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  perform app.enable_default_modules(v_org, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency
     ));

  return v_org;
end;
$fn$;

comment on function public.create_organization(text, text, text[], text, text, text) is
  'Founds an organization and its first membership. The only function here that bootstraps from nothing, which is why it is the only one that must ask whether its caller is anonymous. A currency is optional: a business that has not been asked has not said.';

-- ---------------------------------------------------------------------------
-- What a new business has switched on
-- ---------------------------------------------------------------------------

-- **Guided setup is on at founding, and the reason is that it was unreachable.** The screen
-- whose entire job is to stand a business up was a module that started off, sitting last in the
-- configuration group -- so the way to reach the thing that saves you filling in eight screens
-- was to go through the settings you were trying to avoid. A first-run screen that has to be
-- discovered in settings is not a first-run screen.
--
-- It stays a module, and a business that would rather fill each screen in by hand switches it
-- off in one click. What is deliberately *not* in this list is `assistant`: drafting sends
-- nothing anywhere until somebody types a description and presses a button, while the assistant
-- reads rows out to a model to answer with. Acquiring the second by signing up would be a
-- decision made on a business's behalf.
create or replace function app.enable_default_modules(p_organization_id uuid, p_actor uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.organization_modules (organization_id, module_key, enabled_by)
  select p_organization_id, key, p_actor
  from unnest(array['billing', 'drafting']) as key
  on conflict do nothing;
$fn$;

comment on function app.enable_default_modules(uuid, uuid) is
  'What a founding business gets: billing and guided setup. The kernel is not a module and is not listed; the assistant, assets, booking, the portal and card payments are decisions a business makes rather than defaults it acquires.';

-- Existing businesses are deliberately **not** backfilled. A module is something a business
-- switched on and is billed for, and adding one to a live tenant is this migration deciding
-- something on their behalf -- the same objection `20260829000012` raised in the other
-- direction when it refused to take `assets` away. They have the switch.

-- ---------------------------------------------------------------------------
-- The two writes that need an answer
-- ---------------------------------------------------------------------------

-- **`v_currency is null` used to mean two things and now means one.** It stood in for "no such
-- organization, or you may not price for it", which was sound only because the column could not
-- be null for a business that existed. It can now, so the visibility check reads the id and the
-- currency check reads the currency -- and a business that has not said what it trades in is
-- told that, rather than being told its own organization does not exist.
create or replace function public.create_price_book_item(
  p_organization_id  uuid,
  p_name             text,
  p_unit             text,
  p_unit_amount_minor bigint
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_org      uuid;
  v_currency text;
  v_id       uuid;
begin
  if v_actor is null then
    raise exception 'create_price_book_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Read from the organization and written onto the row, exactly as record_work_item_cost
  -- does. A caller does not get to assert what currency a business prices in, and the
  -- snapshot is the point rather than a side effect.
  select o.id, o.currency into v_org, v_currency
    from public.organizations o
   where o.id = p_organization_id;

  if v_org is null then
    raise exception 'no such organization, or you may not price for it'
      using errcode = '42501';
  end if;

  if v_currency is null then
    raise exception 'this business has not said what it trades in'
      using errcode = '23514';
  end if;

  insert into public.price_book_items
    (organization_id, name, unit, unit_amount_minor, currency, created_by)
  values
    (p_organization_id, p_name, p_unit, p_unit_amount_minor, v_currency, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'price_book_item', v_id, 'price_book_item.created',
     jsonb_build_object(
       'name', p_name,
       'unit', p_unit,
       'unit_amount_minor', p_unit_amount_minor,
       'currency', v_currency
     ));

  return v_id;
end;
$fn$;

-- The same refusal, at the other place an amount is first written down. A cost recorded against
-- a business that has not named a currency would have failed on `work_item_costs.currency`'s
-- not-null constraint, which tells the operator nothing about what to do next.
create or replace function public.record_work_item_cost(
  p_work_item_id uuid,
  p_description  text,
  p_amount_minor bigint,
  p_incurred_at  timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_org      uuid;
  v_currency text;
  v_incurred timestamptz := coalesce(p_incurred_at, now());
  v_id       uuid;
begin
  if v_actor is null then
    raise exception 'record_work_item_cost requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The currency is read from the organization and written onto the row, not passed in. A
  -- caller does not get to assert what currency a business trades in, and the snapshot is
  -- what keeps a later change from rewriting this amount's meaning (I8).
  select w.organization_id, o.currency into v_org, v_currency
    from public.work_items w
    join public.organizations o on o.id = w.organization_id
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item' using errcode = '23503';
  end if;

  if v_currency is null then
    raise exception 'this business has not said what it trades in'
      using errcode = '23514';
  end if;

  insert into public.work_item_costs
    (organization_id, work_item_id, description, amount_minor, currency, incurred_at, created_by)
  values (v_org, p_work_item_id, p_description, p_amount_minor, v_currency, v_incurred, v_actor)
  returning id into v_id;

  -- **The event's own timestamp stays `now()`, and that is the point of having both.** What
  -- happened at this instant is that somebody recorded a cost; what happened last Tuesday is
  -- the cost. The date goes in the payload so a reader of the timeline can tell the two apart
  -- without joining back to a row that may since have been corrected.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.cost_recorded',
     jsonb_build_object(
       'cost_id', v_id,
       'description', p_description,
       'amount_minor', p_amount_minor,
       'currency', v_currency,
       'incurred_at', v_incurred
     ));

  return v_id;
end;
$fn$;
