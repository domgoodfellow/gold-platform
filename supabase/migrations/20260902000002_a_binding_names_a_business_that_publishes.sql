-- An outsider's binding may only name a business that actually publishes bookings, and may
-- never name a customer.
--
-- **Two holes on the D22 axis, both of which the documents already said were closed.** Neither
-- was introduced by a change; both have been there since the axis shipped, and each is the gap
-- between what a migration's comment claimed and what its grants did.
--
-- **The first: `customer_id` was insertable.** `20260829000007` added the column and said of it,
-- in its own words, that it is "written by nothing but the function below. There is no column
-- grant for it and no update policy on the table, so the attack that removed it in the first
-- place -- an outsider writing somebody else's customer id onto their own binding -- is still
-- impossible." The reasoning was right and the mechanism was absent: `20260829000003` had
-- already issued `grant select, insert on public.external_actors to authenticated`, which is
-- **table-wide**, so a column added eight migrations later inherited insert permission from a
-- grant written before it existed. There was never a column grant to leave it out of.
--
-- The consequence was not theoretical. `app.current_external_customer()` reads that column, and
-- twelve policies key off it -- `invoices_select_external` and `payments_select_external` narrow
-- to nothing else. An outsider who supplied a customer id on their own binding was that
-- customer, for reading.
--
-- **The second: the binding named any organization at all.** `external_actors_insert` checked
-- `user_id = auth.uid()` and nothing about `organization_id`. D22's rule is that "a public URL
-- never carries a tenant id" and that the id "is one the server resolved, never one a URL
-- supplied" -- which `beginBooking` honours, because it passes what `booking_organization`
-- returned. But a policy is not a caller, and RLS has to hold against a client that never went
-- near that function. What was protecting this was the shape of the one caller written so far.
--
-- **What is not wrong is the design.** D22 is intact: one binding, one tenant, immutable,
-- `created_by` scoping the rest. This is the fence around it having two gates nobody walked
-- through, and `CLAUDE.md` is corrected in the same change -- it claimed every write goes
-- through `create_booking`, and `beginBooking` has always inserted the binding directly.

-- ---------------------------------------------------------------------------
-- What "publishes bookings" means, in one place
-- ---------------------------------------------------------------------------

-- **Extracted rather than copied**, which is this repository's rule the moment a second caller
-- appears: `booking_organization` has held this predicate inline since the booking slice, and
-- the policy below is the second thing that needs to ask the same question. Two copies would
-- diverge exactly once -- the day a third condition joins "the module is on and a type is
-- published" -- and the copy that did not get it would be the one deciding who may bind.
--
-- `security definer` for the reason `booking_organization` already is: a caller with no binding
-- yet cannot read `work_item_types` at all, because the external read policy keys on the binding
-- they are in the middle of creating. That is the chicken-and-egg D22 names, answered the same
-- way -- privileged, narrow, and it says nothing back except yes or no.
create function app.publishes_bookings(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.module_enabled(p_organization_id, 'booking')
     and exists (
       select 1
       from public.work_item_types t
       where t.organization_id = p_organization_id
         and t.booking_status_id is not null
     );
$fn$;

comment on function app.publishes_bookings(uuid) is
  'Whether this business takes public bookings: the booking module on, and at least one type with a booking status. The one definition -- booking_organization resolves a slug through it and external_actors_insert admits a binding through it.';

revoke all on function app.publishes_bookings(uuid) from public;
grant execute on function app.publishes_bookings(uuid) to authenticated;

-- Now the original caller asks the extracted question instead of its own copy.
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
    and app.publishes_bookings(o.id);
$fn$;

-- ---------------------------------------------------------------------------
-- The grant that should always have been column-scoped
-- ---------------------------------------------------------------------------

-- Two columns, and they are the two `beginBooking` writes. `customer_id` is now genuinely in no
-- column grant, which is what `20260829000007` believed it was arranging -- and `id` and
-- `created_at` are left out for the same reason every other table leaves them out: a default is
-- not something a caller supplies.
--
-- `claim_portal_invite` is unaffected. It is `security definer` owned by the table's owner, and
-- an owner's privileges are not what a column grant restricts.
revoke insert on public.external_actors from authenticated;
grant insert (organization_id, user_id) on public.external_actors to authenticated;

-- ---------------------------------------------------------------------------
-- The policy that has to hold without a caller
-- ---------------------------------------------------------------------------

drop policy external_actors_insert on public.external_actors;

-- **The binding may only name a business that publishes**, which is the narrowest true statement
-- about who may create one. It is not narrower than the product: anyone can reach any bookable
-- business's public page and bind there, so admitting a binding to any *published* business
-- gives away nothing that visiting the page would not. What it refuses is a binding to a
-- business that publishes nothing -- which has no public door, and therefore no outsiders.
create policy external_actors_insert on public.external_actors
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.publishes_bookings(organization_id)
  );

comment on table public.external_actors is
  'D22: one auth.users id bound to exactly one organization, immutable. Created by the visitor for a business that publishes bookings; customer_id is written only by claim_portal_invite and is in no column grant.';
