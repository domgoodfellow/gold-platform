-- A customer initiates their own card payment, and the operator's own reference-update grant
-- was missing since the day it was written.
--
-- **The bug found while reusing this code.** `requestCardPayment` (`lib/domain/billing/
-- card-payments.ts`) creates a `payment_requests` row with the request's own id as a placeholder
-- `provider_reference`, asks the processor, then corrects that column to the processor's real
-- session id — `.update({ provider_reference: ... })`. `20260829000008` granted this table only
-- `select, insert` to `authenticated`, and no migration since has added `update`. Confirmed live
-- (`information_schema.role_table_grants`): `authenticated` holds no `UPDATE` privilege on
-- `payment_requests` at all, so that call has always failed with a bare permission error, for
-- every operator, on every real request — invisible until now because `invoices.test.ts` only
-- ever exercises the webhook side, inserting its own already-corrected row directly rather than
-- calling `requestCardPayment`. Not load-bearing for the money itself — the webhook resolves a
-- settlement by `payment_requests.id` (handed to Stripe as `client_reference_id`), never by
-- `provider_reference` — but it means the one caller this repository ships throws right after a
-- live checkout session was actually created, which is not a business anyone could sell this to.
-- Fixed the same way `customer_portal_invites` already scopes `revoked_at`: a column-scoped grant
-- behind the same capability the insert already requires.
--
-- **The external axis needs its own doors, not a wider grant.** An external actor holds insert on
-- exactly one table anywhere in this schema — its own `external_actors` binding — and every other
-- write about the business goes through a narrow, scope-deriving `SECURITY DEFINER` function
-- (`create_booking`, `claim_portal_invite`). Portal payment keeps that shape rather than becoming
-- the second exception: three functions, each deriving `app.current_external_tenant()`/
-- `app.current_external_customer()` itself rather than accepting either as an argument, each
-- re-proving invoice ownership and entitlement independently of what the page already rendered.
--
-- **The amount is never a client-supplied argument, and it is not a second `invoiceStanding`
-- either.** `app.external_invoice_payment_context` computes an invoice's outstanding balance in
-- SQL — `sum(unit_amount_minor * quantity)` over `invoice_lines` minus `sum(amount_minor)` over
-- `payments` — the same arithmetic `priceWorkItem`/`invoiceStanding` already perform in
-- TypeScript, expressed a second time and pinned by a correspondence test rather than duplicated
-- freely, exactly the shape D35 already uses for `invoiced_and_incurred`. A browser can supply an
-- invoice id and nothing else; every other value a payment needs is derived from what that id
-- resolves to under this caller's own external scope.
--
-- **`payment_accounts` still has no policy for the external axis, and none is added here.**
-- `20260829000011`'s own comment says an outsider must never read it. These functions are
-- `SECURITY DEFINER`, so they read it internally to find a connected account and hand back only
-- its `account_id` — a business already discloses that much the moment its own checkout page asks
-- Stripe to redirect there, and it is never itself a secret (D27) — while the row's own columns
-- (`connected_by`, `connected_at`) never reach the caller at all.

-- ---------------------------------------------------------------------------
-- The operator-side fix
-- ---------------------------------------------------------------------------

create policy payment_requests_update on public.payment_requests
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'payment.record')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'payment.record')
  );

-- Column-scoped, like `customer_portal_invites`' `revoked_at` grant: nothing about a request
-- (which invoice, how much, in what currency) may change after the fact (I8) — only the
-- processor's own reference, once known.
grant update (provider_reference) on public.payment_requests to authenticated;

-- ---------------------------------------------------------------------------
-- What an invoice actually stands at, derived rather than trusted
-- ---------------------------------------------------------------------------

-- Internal: not granted to anyone. `security invoker` is correct and safe here specifically
-- because every caller is itself `SECURITY DEFINER` — by the time this runs, the effective role
-- is already the elevated one, so this reads `invoices`/`invoice_lines`/`payments` the same way
-- regardless, and stays the plain, auditable shape rather than a second definer boundary nested
-- inside the first.
create function app.external_invoice_payment_context(p_invoice_id uuid)
returns table (organization_id uuid, currency text, outstanding_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select i.organization_id,
         i.currency,
         coalesce(
           (select sum(l.unit_amount_minor * l.quantity)
              from public.invoice_lines l
             where l.invoice_id = i.id),
           0
         )
         -
         coalesce(
           (select sum(p.amount_minor)
              from public.payments p
             where p.invoice_id = i.id),
           0
         )
    from public.invoices i
   where i.id = p_invoice_id
     and i.organization_id = app.current_external_tenant()
     and i.customer_id = app.current_external_customer();
$fn$;

comment on function app.external_invoice_payment_context(uuid) is
  'What one invoice stands at, for the external customer it is snapshotted to (I8) -- zero rows for any invoice not truthfully theirs. The same arithmetic invoiceStanding()/priceWorkItem() already perform in TypeScript, pinned by tests/invoices.test.ts rather than duplicated freely (D35''s shape).';

-- ---------------------------------------------------------------------------
-- Whether a Pay action is genuinely available, without creating anything
-- ---------------------------------------------------------------------------

create function public.external_card_payment_availability(
  p_invoice_id uuid,
  p_provider   text
)
returns table (outstanding_minor bigint, currency text, account_id text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_ctx     record;
  v_account public.payment_accounts;
begin
  select * into v_ctx from app.external_invoice_payment_context(p_invoice_id);

  if v_ctx.organization_id is null or v_ctx.outstanding_minor <= 0 then
    return;
  end if;

  -- The wanted/paid intersection `public.usable_modules` already computes, inlined rather than
  -- called: that function is `security invoker`, reading tables the external axis holds no
  -- policy on at all, and calling it from here would only work by accident of which role happens
  -- to be effective at the call site. Written out, this is the one thing to keep in step with
  -- `20260910000002`'s own definition if that ever changes.
  if not exists (
    select 1
      from public.organization_modules m
      join public.organization_commercial_terms t
        on t.organization_id = m.organization_id
       and t.product_key = 'module:' || m.module_key
       and t.period_start <= current_date
       and t.period_end   >  current_date
     where m.organization_id = v_ctx.organization_id
       and m.module_key = 'card_payments'
  ) then
    return;
  end if;

  select * into v_account
    from public.payment_accounts
   where organization_id = v_ctx.organization_id
     and provider = p_provider;

  if v_account.provider is null then
    -- No fallback account (D27) -- absence here is absence of a Pay action, never a reason to
    -- reach for a platform-owned one.
    return;
  end if;

  return query select v_ctx.outstanding_minor, v_ctx.currency, v_account.account_id;
end;
$fn$;

comment on function public.external_card_payment_availability(uuid, text) is
  'Zero or one row: whether the current external customer may pay this invoice by card right now. Read-only -- writes nothing, so a page may call it on every render. Re-proven independently by begin_external_card_payment rather than trusted, since hiding a button is not authorization (I12).';

revoke all on function public.external_card_payment_availability(uuid, text) from public;
grant execute on function public.external_card_payment_availability(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Asking to pay
-- ---------------------------------------------------------------------------

create function public.begin_external_card_payment(
  p_invoice_id uuid,
  p_provider   text
)
returns table (request_id uuid, outstanding_minor bigint, currency text, account_id text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor      uuid := (select auth.uid());
  v_ctx        record;
  v_account    public.payment_accounts;
  v_request_id uuid := gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'begin_external_card_payment requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Re-derived and re-checked in full rather than trusting whatever
  -- external_card_payment_availability last answered -- a UI hiding a button is a courtesy, and
  -- this is the guard (I12). No organization id, no amount, no currency and no account is ever
  -- taken as an argument; every one of them comes from what this invoice id resolves to under
  -- this caller's own external scope.
  select * into v_ctx from app.external_invoice_payment_context(p_invoice_id);

  if v_ctx.organization_id is null then
    raise exception 'no such invoice, or you may not pay it'
      using errcode = '42501';
  end if;

  if v_ctx.outstanding_minor <= 0 then
    raise exception 'there is nothing outstanding on that invoice'
      using errcode = 'GD001';
  end if;

  if not exists (
    select 1
      from public.organization_modules m
      join public.organization_commercial_terms t
        on t.organization_id = m.organization_id
       and t.product_key = 'module:' || m.module_key
       and t.period_start <= current_date
       and t.period_end   >  current_date
     where m.organization_id = v_ctx.organization_id
       and m.module_key = 'card_payments'
  ) then
    raise exception 'this business does not accept card payments'
      using errcode = '42501';
  end if;

  select * into v_account
    from public.payment_accounts
   where organization_id = v_ctx.organization_id
     and provider = p_provider;

  if v_account.provider is null then
    raise exception 'this business has no connected payment account'
      using errcode = '42501';
  end if;

  -- The placeholder-then-correct shape `requestCardPayment` already uses: the row exists before
  -- the processor is told anything, and its own id is what the processor hands back untouched
  -- (Stripe's `client_reference_id`), which is what `record_provider_payment` resolves on rather
  -- than a caller-supplied reference.
  insert into public.payment_requests
    (id, organization_id, invoice_id, provider, provider_reference, amount_minor, currency, created_by)
  values
    (v_request_id, v_ctx.organization_id, p_invoice_id, p_provider, v_request_id::text,
     v_ctx.outstanding_minor, v_ctx.currency, v_actor);

  return query select v_request_id, v_ctx.outstanding_minor, v_ctx.currency, v_account.account_id;
end;
$fn$;

comment on function public.begin_external_card_payment(uuid, text) is
  'The external customer''s one door onto payment_requests. Derives organization, amount, currency and account from the invoice id and this caller''s own external scope; accepts none of them as arguments. Never reaches payment_accounts'' own columns back to the caller beyond account_id.';

revoke all on function public.begin_external_card_payment(uuid, text) from public;
grant execute on function public.begin_external_card_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording what the processor actually said back
-- ---------------------------------------------------------------------------

-- Purely for record-keeping — the webhook never reads this column (it resolves by
-- payment_requests.id, handed to Stripe as client_reference_id) — but an operator looking at a
-- customer-initiated request deserves to see the same real session id an operator-initiated one
-- now will, rather than an inconsistency that looks like a second, lesser path.
create function public.confirm_external_card_payment(
  p_request_id         uuid,
  p_provider_reference text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor   uuid := (select auth.uid());
  v_updated uuid;
begin
  if v_actor is null then
    raise exception 'confirm_external_card_payment requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.payment_requests r
     set provider_reference = p_provider_reference
   where r.id = p_request_id
     and r.organization_id = app.current_external_tenant()
     and r.invoice_id in (
       select i.id
         from public.invoices i
        where i.organization_id = r.organization_id
          and i.customer_id = app.current_external_customer()
     )
  returning r.id into v_updated;

  if v_updated is null then
    raise exception 'no such payment request, or you may not update it'
      using errcode = '42501';
  end if;
end;
$fn$;

comment on function public.confirm_external_card_payment(uuid, text) is
  'Corrects a request this same external customer began to the processor''s real reference. Verifies ownership through the request''s own invoice rather than trusting the id alone.';

revoke all on function public.confirm_external_card_payment(uuid, text) from public;
grant execute on function public.confirm_external_card_payment(uuid, text) to authenticated;
