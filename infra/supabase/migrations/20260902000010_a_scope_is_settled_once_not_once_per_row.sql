-- A scope is settled once per statement, not once per row.
--
-- **No policy changes what it permits here.** Every predicate below is the one already in the
-- database, with two function calls wrapped in scalar subqueries. If this migration alters who
-- can see what, it is wrong, and `booking.test.ts` and `portal.test.ts` are what say so.
--
-- **What it does change is when those functions run.** `app.current_external_tenant()` and
-- `app.current_external_customer()` are `stable`, which permits Postgres to call them once per
-- statement and does not oblige it to. Only `immutable` gets folded to a constant, so a bare
-- `organization_id = app.current_external_tenant()` in a policy is evaluated **for every row
-- the statement touches** -- and each evaluation is a lookup in `external_actors`. A scalar
-- subquery with nothing correlated in it becomes an InitPlan instead: computed once, before
-- the scan, and compared as a constant thereafter.
--
-- The cost fell on the wrong people. These twelve policies exist for outsiders, and RLS ORs
-- every permissive policy on a table together -- so an operator listing a thousand jobs was
-- paying a thousand `external_actors` lookups to satisfy a policy that returns null for them
-- and permits nothing. The outsider, who reads a handful of rows, barely noticed.
--
-- **`auth.uid()` was already wrapped everywhere and stays as it is.** That is the same rule,
-- applied when these policies were written; the two `app.` functions were missed because
-- Supabase's own advisor knows the `auth` ones by name and cannot see a scope function this
-- schema invented. `schema-conformance.test.ts` now asserts the rule for all three, so the
-- next session-scoped function is caught by its shape rather than by somebody remembering.
--
-- `app.has_capability(organization_id, ...)` is deliberately untouched throughout: it takes
-- the row's own column as an argument, so it depends on the row and cannot be lifted out of
-- one. That is a real per-row cost with no version of this fix available, and it falls on
-- writes, which are one row at a time.

-- ---------------------------------------------------------------------------
-- What a business publishes to somebody who has not bought anything yet
-- ---------------------------------------------------------------------------

drop policy organizations_select_external on public.organizations;
create policy organizations_select_external on public.organizations
  for select to authenticated
  using (id = (select app.current_external_tenant()));

drop policy organization_profiles_select_external on public.organization_profiles;
create policy organization_profiles_select_external on public.organization_profiles
  for select to authenticated
  using (organization_id = (select app.current_external_tenant()));

drop policy operating_hours_select_external on public.operating_hours;
create policy operating_hours_select_external on public.operating_hours
  for select to authenticated
  using (organization_id = (select app.current_external_tenant()));

drop policy work_item_types_select_external on public.work_item_types;
create policy work_item_types_select_external on public.work_item_types
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and booking_status_id is not null
  );

drop policy price_book_items_select_external on public.price_book_items;
create policy price_book_items_select_external on public.price_book_items
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and id in (
      select t.booking_price_item_id
      from public.work_item_types t
      where t.organization_id = public.price_book_items.organization_id
        and t.booking_status_id is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Rows they made, or rows about them
-- ---------------------------------------------------------------------------

drop policy work_items_select_external on public.work_items;
create policy work_items_select_external on public.work_items
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and (
      created_by = (select auth.uid())
      or customer_id = (select app.current_external_customer())
    )
  );

drop policy customers_select_external on public.customers;
create policy customers_select_external on public.customers
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and (
      created_by = (select auth.uid())
      or id = (select app.current_external_customer())
    )
  );

drop policy work_item_priced_lines_select_external on public.work_item_priced_lines;
create policy work_item_priced_lines_select_external on public.work_item_priced_lines
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and work_item_id in (
      select w.id
      from public.work_items w
      where w.organization_id = public.work_item_priced_lines.organization_id
        and (
          w.created_by = (select auth.uid())
          or w.customer_id = (select app.current_external_customer())
        )
    )
  );

drop policy invoices_select_external on public.invoices;
create policy invoices_select_external on public.invoices
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and customer_id = (select app.current_external_customer())
  );

drop policy invoice_lines_select_external on public.invoice_lines;
create policy invoice_lines_select_external on public.invoice_lines
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and invoice_id in (
      select i.id
      from public.invoices i
      where i.organization_id = public.invoice_lines.organization_id
        and i.customer_id = (select app.current_external_customer())
    )
  );

drop policy payments_select_external on public.payments;
create policy payments_select_external on public.payments
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and invoice_id in (
      select i.id
      from public.invoices i
      where i.organization_id = public.payments.organization_id
        and i.customer_id = (select app.current_external_customer())
    )
  );

drop policy documents_select_external on public.documents;
create policy documents_select_external on public.documents
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and customer_id = (select app.current_external_customer())
  );

-- ---------------------------------------------------------------------------
-- The lookup behind every policy in this database
-- ---------------------------------------------------------------------------

-- `app.current_tenant_ids()` reads `memberships` by `user_id`, and `memberships` had no index
-- that could serve it. `memberships_org_user_unique` leads with `organization_id` because I2
-- requires it to, which makes it useless for a lookup that knows only who is asking -- and who
-- is asking is all that function knows. So the hottest read in this schema was a sequential
-- scan of the membership table, on every statement any member issues.
--
-- **This is one of fifty-four foreign keys Supabase's advisor reports as unindexed, and the
-- only one being added.** The other fifty-three are almost all `created_by` pointing at
-- `auth.users`, which nothing joins on and nothing filters by; an index there would cost every
-- insert and pay back on nothing. An unindexed foreign key is a question about how the column
-- is read rather than a defect, and this is the one where the answer is "constantly".
create index memberships_user_idx on public.memberships (user_id);

comment on index public.memberships_user_idx is
  'Serves app.current_tenant_ids(). Not redundant with memberships_org_user_unique: that index leads with organization_id (I2) and cannot answer a lookup by user alone.';
