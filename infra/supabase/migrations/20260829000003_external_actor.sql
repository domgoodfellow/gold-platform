-- The external actor, and the first surface that needs one.
--
-- This migration answers D22, which stated four questions and deliberately settled none of
-- them, on the grounds that "whichever surface goes first pays for the model; the other two
-- inherit it, and this record is amended in that slice rather than completed speculatively".
-- Booking goes first. Here are the four answers.
--
--   1. **Bound to what.** A row in `external_actors` binding one `auth.users` id to exactly
--      one organization. Not a customer row: at the moment somebody opens a booking page
--      there is no customer yet, and there must not be one until they commit to something.
--
--   2. **Does it reach Postgres as a JWT.** Yes — Supabase anonymous sign-in, which D22 named
--      as the option costing I11 and D17 the least. It produces a genuine `auth.uid()`, so
--      `events.actor_id not null references auth.users` is untouched and RLS is still the
--      boundary rather than a second one in application code. `config.toml` enables it in the
--      same change, and its rate limit is the abuse control for a page anyone can load.
--
--   3. **Scope.** Exactly one tenant, never a set — and `external_actors_one_tenant_per_user`
--      is what makes that structural. See the note on that index: it deliberately does not
--      lead with `organization_id`, which is the one place in this schema where I2's shape is
--      wrong for the job.
--
--   4. **How I19 is satisfied with no capability to check.** The read under RLS *is* the
--      permission check, exactly as `getDocumentUrl` already works. `app.has_capability` is
--      never consulted on this axis, because there is no role to ask about — every policy
--      below permits a named thing rather than refusing an unnamed one.
--
-- **Every policy here is written as permit, never as "unless refused".** That is the whole of
-- D22's argument against the rejected membership row: a member sees things unless something
-- objects, and an outsider must see nothing unless something explicitly permits. Read the
-- policies below as a list of what a stranger may see of a business, because that is what
-- they are.

-- ---------------------------------------------------------------------------
-- Who an outsider is
-- ---------------------------------------------------------------------------

create table public.external_actors (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now()
);

-- **There is deliberately no `customer_id` here, and the first draft of this table had one.**
--
-- Binding the actor to a customer row meant `create_booking` had to write it, which meant
-- granting an outsider `update` on their own binding -- and an outsider who can write a
-- customer id onto their own binding can write *somebody else's*, at which point every policy
-- keyed to "their customer" hands them that customer's history. The composite foreign key
-- would not have caught it: another customer of the same tenant satisfies it perfectly.
--
-- What identifies their own rows instead is `created_by`, which every insert policy on this
-- axis already pins to `auth.uid()` and which no policy or column grant can move. The binding
-- says which business they are talking to and nothing else, so it never needs to change --
-- and a row that is never updated is one fewer thing to get wrong.
--
-- The portal (D22's second surface) will need to link an outsider to a customer the *business*
-- created, which `created_by` cannot express. That is a real gap, and it gets a column when it
-- has a caller, under the same rule as everything else here.

comment on table public.external_actors is
  'D22''s axis. Binds one auth.users id to exactly one organization. Never a membership: a membership would put an outsider inside app.current_tenant_ids() and hand them the tenant.';

-- **This index does not lead with `organization_id`, and that is the point of it.**
--
-- I2 exists so that one tenant's uniqueness cannot block another's -- two businesses must both
-- be able to call a status "Booked". This constraint is the opposite question: it exists so
-- that one *actor* can never span two tenants. Leading with `organization_id` would permit
-- exactly the row it is here to forbid, because `(org_a, user_x)` and `(org_b, user_x)` would
-- both be unique and `app.current_external_tenant()` would then have a set to return -- which
-- D22 says it must never have.
--
-- `schema-conformance.test.ts` names this table as its one exception, with this reasoning.
create unique index external_actors_one_tenant_per_user
  on public.external_actors (user_id);

create index external_actors_org_idx
  on public.external_actors (organization_id);

alter table public.external_actors enable row level security;
alter table public.external_actors force row level security;

-- ---------------------------------------------------------------------------
-- The scope function
-- ---------------------------------------------------------------------------

-- Deliberately **not** `app.current_tenant_ids()`, and the name is half the point. That
-- function answers "which tenants is this caller *in*" and returns a set; this answers "which
-- single tenant is this caller *outside of, but talking to*" and returns at most one row. They
-- look similar enough that one could be reached for in place of the other, so nothing here
-- shares a name, a signature, or a return type with it.
--
-- SECURITY DEFINER for the same reason `current_tenant_ids` is: a policy on `external_actors`
-- that selected from `external_actors` would recurse. search_path is pinned empty.
create function app.current_external_tenant()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select ea.organization_id
  from public.external_actors ea
  where ea.user_id = (select auth.uid());
$fn$;

comment on function app.current_external_tenant() is
  'D22. At most one organization, never a set -- the structural difference from app.current_tenant_ids(). Returns null for a member, a stranger, and anyone signed out.';

revoke all on function app.current_external_tenant() from public;
grant execute on function app.current_external_tenant() to authenticated;

-- An outsider may see their own binding and create one. They may never change or delete it:
-- moving it would be re-scoping themselves to another tenant, which is the whole attack this
-- axis exists to make impossible.
create policy external_actors_select on public.external_actors
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (select app.current_tenant_ids())
  );

create policy external_actors_insert on public.external_actors
  for insert to authenticated
  with check (user_id = (select auth.uid()));

grant select, insert on public.external_actors to authenticated;

-- ---------------------------------------------------------------------------
-- What a business publishes as bookable
-- ---------------------------------------------------------------------------

-- Configuration, per tenant, like everything else. There is no platform notion of a bookable
-- service: a type becomes bookable when the business says which status a booking starts in and
-- how long one takes, and stops being bookable when it clears them.
--
-- Deliberately **no `bookable` boolean.** A flag beside these columns is a second answer that
-- can contradict the first -- bookable and no status, or a status and not bookable -- and the
-- check below makes the pair the whole answer instead.
alter table public.work_item_types
  add column booking_status_id       uuid,
  add column booking_duration_minutes integer,
  add column booking_price_item_id   uuid;

-- I20's shape: the status must belong to *this type*, not merely to this tenant.
alter table public.work_item_types
  add constraint work_item_types_booking_status_same_type
  foreign key (organization_id, id, booking_status_id)
  references public.work_item_statuses (organization_id, type_id, id);

alter table public.work_item_types
  add constraint work_item_types_booking_price_same_org
  foreign key (organization_id, booking_price_item_id)
  references public.price_book_items (organization_id, id);

alter table public.work_item_types
  add constraint work_item_types_bookable_is_complete
  check (
    (booking_status_id is null and booking_duration_minutes is null)
    or (
      booking_status_id is not null
      and booking_duration_minutes is not null
      and booking_duration_minutes between 5 and 1440
    )
  );

comment on column public.work_item_types.booking_status_id is
  'Which of this type''s own statuses a public booking arrives in. Non-null is what "bookable" means; there is deliberately no separate flag to contradict it.';

grant update (name, booking_status_id, booking_duration_minutes, booking_price_item_id)
  on public.work_item_types to authenticated;

create function public.set_type_bookable(
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
         booking_price_item_id    = p_price_item_id
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

revoke all on function public.set_type_bookable(uuid, uuid, integer, uuid) from public;
grant execute on function public.set_type_bookable(uuid, uuid, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What a stranger may see
-- ---------------------------------------------------------------------------

-- The business itself: its name, the clock it keeps and what it charges in. Everything a
-- booking page has to render, and nothing else -- there is no column on `organizations` that
-- is not already on a business's own website.
create policy organizations_select_external on public.organizations
  for select to authenticated
  using (id = app.current_external_tenant());

-- Only the types it has published, and only while they are published.
create policy work_item_types_select_external on public.work_item_types
  for select to authenticated
  using (
    organization_id = app.current_external_tenant()
    and booking_status_id is not null
  );

-- The one catalogue row a published type points at. Not the catalogue: what a business
-- charges for a booking is public, what it charges for everything else is not.
create policy price_book_items_select_external on public.price_book_items
  for select to authenticated
  using (
    organization_id = app.current_external_tenant()
    and id in (
      select t.booking_price_item_id
      from public.work_item_types t
      where t.organization_id = public.price_book_items.organization_id
        and t.booking_status_id is not null
    )
  );

-- When the business is open. A closing time is not a secret; it is on the door.
create policy operating_hours_select_external on public.operating_hours
  for select to authenticated
  using (organization_id = app.current_external_tenant());

-- ---------------------------------------------------------------------------
-- Availability, without telling a stranger who anyone is
-- ---------------------------------------------------------------------------

-- **This is the sharp part of the surface.** Working out what is free means knowing what is
-- taken, and `work_items` rows say who the customer is and what the job is called. An RLS
-- policy is row-level: permitting a stranger to read the rows would permit them to read the
-- titles, and there is no policy that says "these columns only".
--
-- So the projection is a view, and it publishes two facts: which resource, and when it is
-- occupied. No title, no customer, no status, no price. `security_invoker = off` is what makes
-- that hold -- with invoker semantics the underlying policy would have to permit the row, and
-- permitting the row is exactly what must not happen. The scoping predicate is inside the view
-- instead, where it can be read in one place.
--
-- This is the same shape D14 sanctions for privilege in general: "a narrow SECURITY DEFINER
-- function in a migration -- never a privileged client in TypeScript."
create view public.resource_commitments
with (security_invoker = off) as
select
  w.organization_id,
  w.resource_id,
  w.occupies
from public.work_items w
where w.resource_id is not null
  and w.occupies is not null
  and not w.status_releases_resource
  and (
    w.organization_id in (select app.current_tenant_ids())
    or w.organization_id = app.current_external_tenant()
  );

comment on view public.resource_commitments is
  'When each resource is unavailable, and nothing else. The predicate mirrors work_items_resource_not_double_booked on purpose: I5 requires that availability and the constraint agree, and this is the outside world''s copy of that agreement.';

-- Which resources exist, as ids and nothing more. A resource can be a person (D19), so a
-- stranger learning that "Sam Okafor" is free on Tuesday is a disclosure this platform has no
-- reason to make. A booking needs to know that *something* is free, not who.
create view public.bookable_resources
with (security_invoker = off) as
select r.organization_id, r.id
from public.resources r
where r.organization_id = app.current_external_tenant();

comment on view public.bookable_resources is
  'Resource ids only. Never names: a resource can be a person, and who is free on Tuesday is not a fact a booking page needs to publish.';

grant select on public.resource_commitments, public.bookable_resources to authenticated;

-- ---------------------------------------------------------------------------
-- Taking a booking
-- ---------------------------------------------------------------------------

-- A stranger may read back what they wrote and nothing else. `created_by` is the permission
-- check: it is NOT NULL, `create_booking` sets it to the caller, and there is no update policy
-- or column grant anywhere on this axis that would let it move.
create policy work_items_select_external on public.work_items
  for select to authenticated
  using (
    organization_id = app.current_external_tenant()
    and created_by = (select auth.uid())
  );

create policy customers_select_external on public.customers
  for select to authenticated
  using (
    organization_id = app.current_external_tenant()
    and created_by = (select auth.uid())
  );

-- What the booking was quoted, so a confirmation can show it. Scoped to a job they created,
-- for the same reason and by the same column.
create policy work_item_priced_lines_select_external on public.work_item_priced_lines
  for select to authenticated
  using (
    organization_id = app.current_external_tenant()
    and work_item_id in (
      select w.id
      from public.work_items w
      where w.organization_id = public.work_item_priced_lines.organization_id
        and w.created_by = (select auth.uid())
    )
  );

-- **There is no insert policy for an external actor anywhere, and that is deliberate.**
--
-- The first draft of this migration had four: customers, work items, events and priced lines,
-- each permitting a stranger scoped to the tenant. They worked, and they were wrong in a way
-- that only showed up when a returning customer tried to book twice -- `customers_org_email_unique`
-- refused the second row, and there was no way to attach the booking to the customer already
-- there, because a policy narrow enough to be safe cannot see them.
--
-- Widening the read to fix that would have handed a stranger the customer list. So the write
-- side became one function instead, and the surface got *smaller*: a stranger now has no
-- insert permission on any table at all, and there is exactly one shape of write they can
-- perform. RLS is still the boundary for everything they can **read**, which is where a leak
-- would actually live.
--
-- SECURITY DEFINER, with the scope check as its first act -- the same shape as
-- `create_organization`, which is privileged for the same reason: there is no tenant to be a
-- member of yet, and here there is no customer to be one yet. Nothing about D17 changes; the
-- caller still arrives as their own JWT and that JWT is what authorizes this.
create function public.create_booking(
  p_organization_id uuid,
  p_type_id         uuid,
  p_resource_id     uuid,
  p_starts_at       timestamptz,
  p_name            text,
  p_email           text,
  p_phone           text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_scope    uuid := app.current_external_tenant();
  v_type     public.work_item_types;
  v_email    text := nullif(btrim(p_email), '');
  v_customer uuid;
  v_item     uuid;
begin
  if v_actor is null then
    raise exception 'create_booking requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- **The whole authorization of this function, and it is one line.** This runs privileged, so
  -- nothing below is restrained by RLS -- every scope below is therefore written out rather
  -- than assumed. A caller bound to another business, or to none, stops here.
  if v_scope is null or v_scope is distinct from p_organization_id then
    raise exception 'you are not booking with this business'
      using errcode = '42501';
  end if;

  -- One booking per visitor. Without this a single anonymous session could fill a diary, and
  -- the binding is the only thing that identifies them. A distinct SQLSTATE, because 23505 is
  -- also what a duplicate email raises and the two mean opposite things to a person.
  if exists (
    select 1
    from public.work_items w
    where w.organization_id = p_organization_id
      and w.created_by = v_actor
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

  -- **A returning customer books against the record they already have.** The first draft
  -- created a new row every time and refused to look one up, on the grounds that matching an
  -- address somebody typed lets a stranger attach a booking to another customer's history.
  -- That reasoning was about *reading*, and the read policies above key on `created_by` rather
  -- than on the customer -- so attaching discloses nothing at all. What it does risk is a
  -- booking landing on the wrong person's record when somebody mistypes, which is a
  -- data-quality problem the business can see and fix, and a far smaller one than a business
  -- unable to take a second booking from its own customer.
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

  -- The duration is the type's, never the caller's. A caller who could choose it could book
  -- the van for a week. This is the one place a booking's shape is decided, and it is decided
  -- by what the business published.
  insert into public.work_items (
    organization_id, type_id, status_id, customer_id, resource_id, title,
    scheduled_during, created_by
  )
  values (
    p_organization_id,
    p_type_id,
    v_type.booking_status_id,
    v_customer,
    p_resource_id,
    v_type.name || ' — ' || p_name,
    tstzrange(
      p_starts_at,
      p_starts_at + make_interval(mins => v_type.booking_duration_minutes),
      '[)'
    ),
    v_actor
  )
  returning id into v_item;

  -- **I6, and this is where it is proved rather than described.** Nothing checked whether the
  -- slot was still free. The exclusion constraint refuses this insert in the transaction that
  -- would have written it, which is the only re-assertion that does not race -- a check before
  -- the insert races identically, which is the whole content of that invariant.

  if v_type.booking_price_item_id is not null then
    perform public.add_work_item_priced_line(v_item, v_type.booking_price_item_id, 1);
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_item, 'work_item.booked',
     jsonb_build_object(
       'title', v_type.name,
       'customer_id', v_customer,
       'resource_id', p_resource_id,
       'starts_at', p_starts_at
     ));

  return v_item;
end;
$fn$;

revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text) from public;
grant execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text) to authenticated;
