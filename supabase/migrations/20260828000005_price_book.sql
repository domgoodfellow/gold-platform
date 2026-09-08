-- What a business charges for, in its own words and its own money.
--
-- This is the first half of I4 — "there is exactly one price calculation" — and it is
-- deliberately only the half that holds the numbers. Nothing here calculates anything. The
-- calculation lands with the lines that consume this catalogue, in one function, because an
-- invariant about there being exactly one of something is easiest to break by building the
-- second one first and calling it a helper.
--
-- **A price is not a cost, and the two tables are not symmetric by accident.** M2's
-- `work_item_costs` records an observation about a job that already happened — what the part
-- cost, what the subcontractor charged. This records a claim the business publishes in
-- advance. `roadmap.md` M2 makes the distinction and this migration is where it stops being
-- a note and starts being two tables.
--
-- **The currency is on the row, not joined from the organization.** `organizations.currency`
-- is editable (20260828000003), so a catalogue amount with no currency of its own would be
-- silently reinterpreted the moment a business changed what it trades in: 5000 meaning fifty
-- euro on Monday and fifty dollars on Tuesday, with nothing anywhere recording that anybody
-- decided that. An amount without a currency is not an amount. This is I10 applied to
-- configuration rather than to history, and it is the same reasoning `work_item_costs`
-- already uses — snapshotted at insert, never joined at render.
--
-- Consequently `currency` is absent from the update grant below, for the same reason `kind`
-- is absent from `field_definitions`': changing it does not convert an amount, it reinterprets
-- one. A business that changes currency re-prices its catalogue, which is work it should see
-- itself doing.

-- ---------------------------------------------------------------------------
-- The capability
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
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
    'price.manage'
  ]::text[]);

-- Backfilled onto whoever may change the organization's own settings, not onto whoever may
-- configure fields. Deciding what the business charges is a claim it makes about itself, in
-- the same family as the currency it trades in — the distinction 20260828000003 drew between
-- naming a board column and changing the business.
update public.roles
   set capabilities = capabilities || array['price.manage']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('price.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

create table public.price_book_items (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations (id) on delete cascade,

  -- The tenant's own word for the thing it sells. No platform vocabulary here at all: there
  -- is no seeded catalogue, no starter set and no default item, for the same reason there is
  -- no default working week (constraints.md: never hardcode prices or service types).
  name              text        not null check (length(btrim(name)) between 1 and 200),

  -- What one of it is. "hour", "visit", "each", "km" — a label, not an enum, because the
  -- platform has no list of units a business is allowed to sell in.
  unit              text        not null check (length(btrim(unit)) between 1 and 40),

  -- Integer minor units (I10). bigint for the same reason work_item_costs is: 2^31 minor
  -- units is about twenty-one million euro, which is a plausible contract value.
  unit_amount_minor bigint      not null,

  -- Snapshotted from the organization at creation, never joined. See the header.
  currency          text        not null check (currency ~ '^[A-Z]{3}$'),

  created_at        timestamptz not null default now(),
  created_by        uuid        not null references auth.users (id),

  -- Zero is a real price — an item included at no charge is something a business genuinely
  -- publishes. Negative is not: a discount must never exceed what the business provably
  -- saved, which needs travel cost modelling that does not exist, and is recorded in
  -- constraints.md under "Decided, not yet built". A negative line item would be that
  -- feature arriving by the back door with none of the reasoning.
  constraint price_book_items_amount_not_negative check (unit_amount_minor >= 0)
);

comment on table public.price_book_items is
  'What a tenant charges for, with the currency snapshotted onto each amount (I10, I8). Calculates nothing — see I4.';

-- I2: organization_id leads. Two businesses both selling a "Callout" is ordinary, and if
-- this were unique (name) alone the second one could never say so.
create unique index price_book_items_org_name_unique
  on public.price_book_items (organization_id, lower(btrim(name)));

-- I18: something referencing an item and a tenant must reference both together. Nothing does
-- yet — the lines that will are the next migration — but the target index is what makes that
-- composite reference possible, and adding it here costs nothing.
create unique index price_book_items_org_id_unique
  on public.price_book_items (organization_id, id);

alter table public.price_book_items enable row level security;
alter table public.price_book_items force row level security;

-- RLS decides which rows; the table grant decides whether `authenticated` may reach the
-- table at all. Both are required — a policy on a table with no grant refuses everybody, and
-- a grant with no policy would return every tenant's rows.
grant select, insert on public.price_book_items to authenticated;

create policy price_book_items_select on public.price_book_items
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy price_book_items_insert on public.price_book_items
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'price.manage')
  );

create policy price_book_items_update on public.price_book_items
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'price.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'price.manage')
  );

-- Name, unit and amount. Not `currency` — see the header; changing it reinterprets an amount
-- rather than converting one, and a policy cannot express that because it sees the old row or
-- the new one but never both.
grant update (name, unit, unit_amount_minor) on public.price_book_items to authenticated;

-- ---------------------------------------------------------------------------
-- Writing one
-- ---------------------------------------------------------------------------

create function public.create_price_book_item(
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
  select o.currency into v_currency
    from public.organizations o
   where o.id = p_organization_id;

  if v_currency is null then
    raise exception 'no such organization, or you may not price for it'
      using errcode = '42501';
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

revoke all on function public.create_price_book_item(uuid, text, text, bigint) from public;
grant execute on function public.create_price_book_item(uuid, text, text, bigint) to authenticated;

create function public.update_price_book_item(
  p_id                uuid,
  p_name              text,
  p_unit              text,
  p_unit_amount_minor bigint
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
    raise exception 'update_price_book_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Re-pricing the catalogue is expected and safe, and it is safe for a reason worth stating
  -- rather than assuming: nothing that has already been priced reads this row again. The
  -- lines on a work item copy what they need at the moment they are added, so this update
  -- changes what the next job is quoted and nothing about any job that exists (I8).
  update public.price_book_items
     set name              = p_name,
         unit              = p_unit,
         unit_amount_minor = p_unit_amount_minor
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such item, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'price_book_item', p_id, 'price_book_item.updated',
     jsonb_build_object('name', p_name, 'unit', p_unit, 'unit_amount_minor', p_unit_amount_minor));
end;
$fn$;

revoke all on function public.update_price_book_item(uuid, text, text, bigint) from public;
grant execute on function public.update_price_book_item(uuid, text, text, bigint) to authenticated;
