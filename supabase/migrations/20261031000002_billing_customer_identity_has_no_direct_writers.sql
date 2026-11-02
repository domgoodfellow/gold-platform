-- Withdraw ordinary sessions' direct writes on platform_billing_customers.
--
-- Second half of 20261031000001. Apply only after the deployed apps/web provisions an
-- organization's billing customer through apps/api (`/platform-billing/customer`); before that,
-- the deployed web still inserts and updates its own row directly, and a first checkout would fail.
-- From here the only writers are begin_platform_billing_customer (a pending reservation, for a
-- billing manager) and finalize_platform_billing_customer (the processor's reference, for the
-- billing provisioner alone). Members keep reading their own row.
begin;

-- Column grants are revoked as well as table grants, because a column grant survives a table revoke.
drop policy if exists platform_billing_customers_insert on public.platform_billing_customers;
drop policy if exists platform_billing_customers_update on public.platform_billing_customers;
revoke insert, update, delete on public.platform_billing_customers from authenticated, anon;
revoke insert (id, organization_id, environment, provider, customer_reference, created_by, created_at),
       update (id, organization_id, environment, provider, customer_reference, created_by, created_at)
  on public.platform_billing_customers from authenticated, anon;

commit;
