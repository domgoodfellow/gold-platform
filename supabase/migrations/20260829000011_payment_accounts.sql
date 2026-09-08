-- A business connects its own processor account.
--
-- **What is stored here is an account id, not a credential** (D27). It grants nothing on its
-- own, it is useless without the platform's own key, and the business can revoke it from their
-- own processor dashboard without telling us. That is what makes this per-tenant configuration
-- like a currency or a timezone rather than a secret needing a vault.
--
-- **The money never reaches GOLD.** Charges are created *on* the connected account, so funds go
-- straight to the business and no balance of ours is ever involved. D27 records why that is a
-- legal position rather than a preference: a platform that collects and pays out is a money
-- transmitter in most jurisdictions, and the charge type is what decides it.
--
-- **This replaces nothing about the webhook.** `record_provider_payment` routes on
-- `payment_requests`, whose row already carries the organization, so a connected-account event
-- lands correctly without the handler ever reading whose account it came from.

create table public.payment_accounts (
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- Which processor. Named rather than assumed, so a second one is a row and not a migration.
  provider        text        not null check (length(btrim(provider)) between 1 and 40),

  -- The processor's identifier for the business's own account. Deliberately not called
  -- `stripe_account_id`: this table has no opinion about who the processor is, which is the
  -- same discipline the adapter boundary keeps one layer up (I15).
  account_id      text        not null check (length(btrim(account_id)) between 1 and 200),

  connected_at    timestamptz not null default now(),
  connected_by    uuid        not null references auth.users (id),

  -- `organization_id` leads it because it is the primary key (I2). One account per processor
  -- per business: a business with two accounts at one processor has a question to answer that
  -- no caller has asked.
  primary key (organization_id, provider)
);

comment on table public.payment_accounts is
  'The processor account a business connected. Holds an account id, never a key -- see constraints.md D27.';

alter table public.payment_accounts enable row level security;
alter table public.payment_accounts force row level security;

create policy payment_accounts_select on public.payment_accounts
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- `organization.manage`, the same capability that changes the currency. Connecting an account
-- decides where this business's money goes, which is not a dispatcher's decision.
create policy payment_accounts_insert on public.payment_accounts
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and connected_by = (select auth.uid())
    and app.has_capability(organization_id, 'organization.manage')
  );

create policy payment_accounts_delete on public.payment_accounts
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

-- No update policy, for the reason `organization_modules` has none: reconnecting is a delete
-- and an insert, which leaves a fresh `connected_at`. An updated row would quietly re-point a
-- business's payments at a different account with nothing recording that it moved.
grant select, insert, delete on public.payment_accounts to authenticated;

-- **An outsider must never read this.** There is no policy for `app.current_external_tenant()`
-- here and none may be added: a customer paying an invoice needs a payment link, which the
-- business's own server produces. Which account it settles into is not theirs to see.
