-- What a job is quoted, and the only place a price is derived.
--
-- This completes I4. `price_book_items` holds what a business charges for; these are the
-- lines one job actually carries, and `priceWorkItem` in the domain layer is the single
-- function that turns them into a number. Nothing else totals, and nothing else may.
--
-- **A line copies from the catalogue; it never joins to it.** There is deliberately no
-- foreign key back to `price_book_items` — not a nullable one, not a composite one. The
-- description, the unit, the amount and the currency are all copied at the moment the line is
-- added, exactly as `create_work_item` copies a type's checklist template onto a job
-- (20260828000002). That is what makes re-pricing the catalogue safe: today's edit changes
-- what the next job is quoted and nothing about a job that already exists (I8).
--
-- The absence of the foreign key is the enforcement. A reference, even one nobody follows at
-- render time, is an invitation for somebody to follow it later — and the first `select ...
-- join price_book_items` written for a perfectly good reason would silently make every
-- historical quote track the current catalogue.
--
-- **Quantity is an integer, and there is no rounding rule anywhere.** A business that bills
-- half-hours prices per half-hour. This is not an oversight to be corrected with a numeric
-- type: `unit_amount_minor * quantity` in integers is exact, and the moment a fractional
-- quantity exists somebody must decide how a half-cent rounds — which is a pricing decision
-- and belongs in the one calculation, not in a column type chosen in passing.
--
-- **One work item, one currency, enforced by an exclusion constraint.** After a business
-- changes what it trades in, its catalogue holds items in two currencies (see the previous
-- migration for why they are not converted). A job drawing lines from both would have a total
-- that is not a number in any currency. This could have been a check before the insert; it is
-- not, for the same reason I6 gives — a check before an insert races identically, and the
-- database can simply refuse. `with <>` is the whole trick: two lines conflict when they
-- belong to the same job and disagree.

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
    'price.manage',
    'work_item.price'
  ]::text[]);

-- Distinct from price.manage, and the split is the same one the platform keeps making.
-- Deciding what a callout costs is a claim the business publishes; putting two callouts on
-- Tuesday's job is operating the business. Those are plausibly different people, and the
-- backfill says so: this goes to whoever may already record what a job consumed, not to
-- whoever sets the catalogue.
update public.roles
   set capabilities = capabilities || array['work_item.price']::text[]
 where 'work_item.record' = any (capabilities)
   and not ('work_item.price' = any (capabilities));

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------

create table public.work_item_priced_lines (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null,
  work_item_id      uuid        not null,

  -- Copied from the catalogue at the moment this line was added, and never read back from
  -- it. See the header: the absence of a reference is the point, not an omission.
  description       text        not null check (length(btrim(description)) between 1 and 200),
  unit              text        not null check (length(btrim(unit)) between 1 and 40),
  unit_amount_minor bigint      not null check (unit_amount_minor >= 0),
  currency          text        not null check (currency ~ '^[A-Z]{3}$'),

  quantity          integer     not null,

  created_at        timestamptz not null default now(),
  created_by        uuid        not null references auth.users (id),

  -- I18: the reference carries the tenant, so a line cannot name another tenant's job. RLS
  -- would be satisfied by the row's own organization_id and would raise no objection at all.
  constraint work_item_priced_lines_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade,

  -- Zero quantity is a line that says nothing; negative is the discount constraints.md
  -- defers. Both are refused here rather than in the domain layer alone, because a direct
  -- PostgREST insert never passes through it.
  constraint work_item_priced_lines_quantity_positive check (quantity > 0),

  -- One job, one currency. See the header for why this is a constraint and not a check
  -- before the insert.
  constraint work_item_priced_lines_one_currency
    exclude using gist (organization_id with =, work_item_id with =, currency with <>)
);

comment on table public.work_item_priced_lines is
  'What a job is quoted: catalogue values copied, never joined (I8). Totalled in exactly one place (I4).';

create index work_item_priced_lines_org_work_item_idx
  on public.work_item_priced_lines (organization_id, work_item_id);

alter table public.work_item_priced_lines enable row level security;
alter table public.work_item_priced_lines force row level security;

grant select, insert, delete on public.work_item_priced_lines to authenticated;

create policy work_item_priced_lines_select on public.work_item_priced_lines
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy work_item_priced_lines_insert on public.work_item_priced_lines
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'work_item.price')
  );

-- Removable, not editable. A quote is built up and a mistyped line is struck out rather than
-- amended: "never rewrite history" makes an amount a snapshot, and a snapshot that can be
-- edited in place is not one. There is deliberately no update policy and no column grant, so
-- a raw PostgREST update is refused for want of any policy permitting it.
create policy work_item_priced_lines_delete on public.work_item_priced_lines
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'work_item.price')
  );

-- ---------------------------------------------------------------------------
-- Adding one
-- ---------------------------------------------------------------------------

create function public.add_work_item_priced_line(
  p_work_item_id       uuid,
  p_price_book_item_id uuid,
  p_quantity           integer
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_item  record;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'add_work_item_priced_line requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Both reads run under RLS as the caller, so neither can reach another tenant. That is why
  -- there is no explicit organization argument to be tampered with: the job decides which
  -- tenant this is, and the catalogue item is then required to agree.
  select w.organization_id into v_org
    from public.work_items w
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item, or you may not price it'
      using errcode = '42501';
  end if;

  select p.name, p.unit, p.unit_amount_minor, p.currency into v_item
    from public.price_book_items p
   where p.id = p_price_book_item_id
     and p.organization_id = v_org;

  if v_item is null then
    raise exception 'no such priced item in this business'
      using errcode = '23503';
  end if;

  -- The copy. Every value below comes from the catalogue row read a moment ago and is
  -- written down here; nothing links back, so nothing can be rewritten by a later edit (I8).
  insert into public.work_item_priced_lines
    (organization_id, work_item_id, description, unit, unit_amount_minor, currency,
     quantity, created_by)
  values
    (v_org, p_work_item_id, v_item.name, v_item.unit, v_item.unit_amount_minor,
     v_item.currency, p_quantity, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.line_added',
     jsonb_build_object(
       'line_id', v_id,
       'description', v_item.name,
       'unit_amount_minor', v_item.unit_amount_minor,
       'currency', v_item.currency,
       'quantity', p_quantity
     ));

  return v_id;
end;
$fn$;

revoke all on function public.add_work_item_priced_line(uuid, uuid, integer) from public;
grant execute on function public.add_work_item_priced_line(uuid, uuid, integer) to authenticated;

create function public.remove_work_item_priced_line(p_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_work  uuid;
begin
  if v_actor is null then
    raise exception 'remove_work_item_priced_line requires an authenticated caller'
      using errcode = '42501';
  end if;

  delete from public.work_item_priced_lines
   where id = p_id
  returning organization_id, work_item_id into v_org, v_work;

  -- A delete the policy refused removes zero rows and raises nothing. Without this the event
  -- below would record a removal that never happened -- the trap change_work_item_status
  -- already names.
  if v_org is null then
    raise exception 'no such line, or you may not remove it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', v_work, 'work_item.line_removed',
     jsonb_build_object('line_id', p_id));
end;
$fn$;

revoke all on function public.remove_work_item_priced_line(uuid) from public;
grant execute on function public.remove_work_item_priced_line(uuid) to authenticated;
