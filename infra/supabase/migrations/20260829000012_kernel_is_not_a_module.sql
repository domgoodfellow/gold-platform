-- The kernel stops being four required modules.
--
-- `20260829000009_modules.sql` shipped `work`, `scheduling`, `customers` and `billing` as
-- modules marked required, and that was a contradiction in terms: a module is by definition the
-- part a business *chooses*. It was not a naming problem. Every area in `AREAS` belonged to one
-- of those four, so the navigation filter could never remove an entry, and module enablement
-- could not change one line of what a business saw. The caller `roadmap.md` M4 named for the
-- whole feature -- an owner-operator who does not want *Assets* on their phone -- was
-- unreachable on the day it shipped.
--
-- What a business always gets is now simply not in the list: work, the schedule, customers,
-- locations, resources, fields, roles and settings are the kernel, sold to nobody separately
-- and switchable by nobody. What remains a module is what a business can genuinely decline --
-- `billing`, `assets`, `booking`, `portal`, `card_payments`.
--
-- **This migration deletes rows naming keys that are no longer modules**, which is unusual
-- enough to say why. `listEnabledModules` already skips unrecognised keys, so leaving them
-- would be harmless and invisible -- and that is the argument against leaving them. A row
-- saying a business enabled `work` is a record of a decision nobody made, and the first
-- person to read `organization_modules` directly would take it for one.

-- ---------------------------------------------------------------------------
-- What a founding business gets
-- ---------------------------------------------------------------------------

-- **Billing and nothing else.** A business signing up almost certainly wants to quote and
-- invoice, and can switch it off the moment it turns out they do that elsewhere. `assets` is
-- deliberately off: a clinic services nothing it can point at, and a business that has customer
-- machines switches it on. Booking, the portal and card payments stay off for the reason the
-- original migration gave and which has not changed -- publishing a page to the internet is not
-- a default anybody should acquire by signing up.
create or replace function app.enable_default_modules(p_organization_id uuid, p_actor uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.organization_modules (organization_id, module_key, enabled_by)
  select p_organization_id, key, p_actor
  from unnest(array['billing']) as key
  on conflict do nothing;
$fn$;

comment on function app.enable_default_modules(uuid, uuid) is
  'What a founding business gets: billing. The kernel is not a module and is not listed; assets, booking, the portal and card payments are decisions a business makes rather than defaults it acquires.';

-- ---------------------------------------------------------------------------
-- Existing businesses
-- ---------------------------------------------------------------------------

-- `assets` before the deletes, and for the same reason the original migration backfilled a
-- booking row for any business with a slug: every organization can see the Assets area today,
-- and taking it away would be this migration deciding something about a live tenant. A business
-- that never wanted it now has a switch, which is the point.
insert into public.organization_modules (organization_id, module_key, enabled_by)
select o.id, 'assets', m.user_id
from public.organizations o
join lateral (
  select ms.user_id from public.memberships ms
  where ms.organization_id = o.id
  order by ms.created_at
  limit 1
) m on true
on conflict do nothing;

-- The keys that are no longer modules. `billing` is deliberately absent from this list: it is
-- still a module and every existing business keeps the row it already has.
delete from public.organization_modules
 where module_key in ('work', 'scheduling', 'customers');
