-- Modules that actually switch something off.
--
-- 20260829000009 shipped `organization_modules` and wired it to the operator's navigation. The
-- three modules that own a surface *outside* the shell -- public booking, the customer portal,
-- card payments -- were declared with an `outside` field and enforced nowhere, so switching
-- "Public booking" off hid nothing and the public page stayed live.
--
-- **That is worse than not shipping the switch.** A control that does nothing is a business
-- believing its page is down when it is not, and finding out from a customer.
--
-- **Enforcement is in the database, not the page**, for the ordinary reason: the page is a
-- redirect and a redirect is not the boundary (I12). Two of the three callers here are
-- unauthenticated or externally scoped and could not read `organization_modules` under RLS
-- anyway, so the check lives inside the privileged functions they already go through.

-- ---------------------------------------------------------------------------
-- The one question
-- ---------------------------------------------------------------------------

-- One function, so that "has this business switched X on" has a single answer for the same
-- reason `app.has_capability` is the single answer to what a role may do. They are deliberately
-- separate: a capability is what a *member* may do inside a business, and this is what the
-- business bought. Nothing in this file is ever called from an RLS `using` clause on a
-- tenant-owned table -- modules decide what exists, never who may see it.
create function app.module_enabled(p_organization_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_modules m
    where m.organization_id = p_organization_id
      and m.module_key = p_module_key
  );
$fn$;

comment on function app.module_enabled(uuid, text) is
  'Has this business switched this module on. Security definer because the callers are outsiders with no read on the table. Never used as an RLS predicate -- see D25.';

revoke all on function app.module_enabled(uuid, text) from public;
grant execute on function app.module_enabled(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public booking
-- ---------------------------------------------------------------------------

-- A business that has switched booking off has no public presence at all: the slug resolves to
-- nothing and the page 404s, which is the same answer a stranger gets for a business that never
-- published a bookable type. Those two are indistinguishable from outside on purpose.
create or replace function public.booking_organization(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id
  from public.organizations o
  where o.slug = lower(btrim(p_slug))
    and app.module_enabled(o.id, 'booking')
    and exists (
      select 1
      from public.work_item_types t
      where t.organization_id = o.id
        and t.booking_status_id is not null
    );
$fn$;

comment on function public.booking_organization(text) is
  'Slug to organization id, for a caller who has no binding yet and therefore no RLS scope. Answers only for a business that has switched booking on and published a bookable type -- both, and neither is distinguishable from outside.';

-- **`create_booking` re-checks rather than trusting that the visitor came through the slug.**
-- The organization id is an argument, and a stranger who kept one from before the switch was
-- thrown would otherwise still be able to commit work. That is the same reasoning D17 gives
-- about a path segment: it is routing convenience, never an authorization input.
create or replace function app.assert_module_enabled(p_organization_id uuid, p_module_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not app.module_enabled(p_organization_id, p_module_key) then
    raise exception 'this business does not offer that'
      using errcode = '42501';
  end if;
end;
$fn$;

comment on function app.assert_module_enabled(uuid, text) is
  'The same question as app.module_enabled, raising instead of returning. For the privileged functions an outsider writes through.';

revoke all on function app.assert_module_enabled(uuid, text) from public;
grant execute on function app.assert_module_enabled(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The two privileged functions an outsider writes through
-- ---------------------------------------------------------------------------

-- Re-declared in full, which is what `create or replace` requires and what this repository
-- already does whenever a function grows an argument or a step (see `create_organization`,
-- replaced twice). Each gains one check, placed immediately after the scope check it already
-- had, because "is this business offering this" is the same kind of question as "are you
-- talking to this business".

create or replace function public.create_booking(
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

  -- **Added by 20260829000010: re-checked rather than inferred from how the visitor got here.**
  -- The organization id is an argument, so a stranger holding one from before the switch was
  -- thrown would otherwise still commit work -- the same reasoning D17 gives about a path
  -- segment being routing convenience and never an authorization input.
  perform app.assert_module_enabled(p_organization_id, 'booking');

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

create or replace function public.claim_portal_invite(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_invite public.customer_portal_invites;
begin
  if v_actor is null then
    raise exception 'claim_portal_invite requires an authenticated caller'
      using errcode = '42501';
  end if;

  select * into v_invite
  from public.customer_portal_invites
  where token = p_token
    and revoked_at is null;

  -- One message for "no such link" and "withdrawn". Telling them apart would let somebody
  -- holding a revoked link learn that it was once real.
  if v_invite.id is null then
    raise exception 'that link is not valid'
      using errcode = '42501';
  end if;

  -- **Added by 20260829000010.** A business that switches the portal off stops issuing links
  -- and stops accepting the ones it already sent, which is what switching it off means. The
  -- message is the invalid-link one, so a dead link and a withdrawn one stay indistinguishable.
  if not app.module_enabled(v_invite.organization_id, 'portal') then
    raise exception 'that link is not valid'
      using errcode = '42501';
  end if;

  -- **A binding is still exactly one tenant.** Somebody who has already booked with another
  -- business, or with this one anonymously, cannot be promoted into this customer -- the unique
  -- index on `user_id` refuses the insert, and the update below only ever touches a binding
  -- that already names this organization.
  insert into public.external_actors (organization_id, user_id, customer_id)
  values (v_invite.organization_id, v_actor, v_invite.customer_id)
  on conflict (user_id) do update
    set customer_id = excluded.customer_id
  where public.external_actors.organization_id = v_invite.organization_id;

  if not found then
    raise exception 'this browser is already booking with another business'
      using errcode = '42501';
  end if;

  return v_invite.organization_id;
end;
$fn$;

revoke all on function public.claim_portal_invite(text) from public;
grant execute on function public.claim_portal_invite(text) to authenticated;
