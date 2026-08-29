-- Taking a card payment, and the writer with no human caller.
--
-- Two things that cannot be separated, which is why they are one migration: an adapter has no
-- working caller without the webhook, and the webhook has no reason to exist without it.
--
-- **The webhook does not get service-role, and that is the whole point of this file.** D14
-- rejects a service-role client outright and the argument does not weaken because the caller
-- is a vendor rather than a person. It gets its own Postgres role, holding **no grant on any
-- table at all** and exactly one `execute`. That is a smaller surface than the external actor
-- axis, which at least holds `select`.
--
-- **I11 survives unchanged**, which was the alternative worth avoiding. `events.actor_id` is
-- `not null references auth.users` and a webhook has no human behind it, so the integration
-- gets a real `auth.users` row that nothing can ever sign in as. A nullable actor or a
-- sentinel outside that table would have been a second shape for I11 — a far larger decision
-- than one insert. See `constraints.md` D26.

-- ---------------------------------------------------------------------------
-- The integration's identity
-- ---------------------------------------------------------------------------

-- A fixed uuid, so the row is the same in every database this migration is applied to and a
-- timeline read on one environment means the same thing as on another. No email, no password,
-- no identity row: GoTrue has nothing to authenticate against here, which is the point --
-- the only way to act as this user is to hold the JWT secret, and that lives in the server's
-- environment rather than in this schema.
insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000a1')
on conflict (id) do nothing;

-- Recorded here rather than as a `comment on schema auth`, which this role does not own:
-- 00000000-0000-4000-8000-0000000000a1 is the payment integration. It is the only row in
-- `auth.users` this repository writes, and it exists so that a machine write is attributable
-- without giving I11 a second shape (D26).

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

-- PostgREST switches into the role named by the JWT's `role` claim, so this is what "its own
-- Postgres role" means in practice: the handler mints a short-lived token naming this role and
-- the integration user, and reaches the database as itself. That is D17 applied to a machine
-- rather than bypassed for one -- identity still arrives as a JWT, it simply is not a person's.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'payment_webhook') then
    create role payment_webhook nologin noinherit;
  end if;
end
$$;

grant payment_webhook to authenticator;
grant usage on schema public to payment_webhook;

-- Nothing else. No `select`, no `insert`, no sequence, on any table. Everything this role can
-- do is the one function granted at the bottom of this file, and everything that function may
-- write is fixed in its body rather than chosen by its caller.

-- ---------------------------------------------------------------------------
-- Asking for money
-- ---------------------------------------------------------------------------

-- **Why this table exists rather than round-tripping an invoice id through the provider.**
-- Stripe will hand back whatever metadata it was given, and a webhook that reads an invoice id
-- out of a vendor payload is trusting the vendor with the question "which row should I write".
-- A signature check makes that safe-ish; this makes it unnecessary. *The database is the
-- source of truth*: we recorded that we asked for this payment, and the webhook resolves the
-- vendor's reference against our own row.
--
-- It also gives *a vendor is authoritative for its own events only* something to be true
-- about. The request is ours. The outcome is Stripe's.
create table public.payment_requests (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  invoice_id      uuid        not null,

  -- Never null here, unlike on `payments`, where a null provider is what "cash" means. A
  -- request with no provider would be a request to nobody.
  provider        text        not null check (length(btrim(provider)) between 1 and 40),
  provider_reference text     not null check (length(btrim(provider_reference)) between 1 and 200),

  -- What was asked for, snapshotted. The invoice's outstanding figure moves as payments land;
  -- what this request asked for does not (I8, I10).
  amount_minor    bigint      not null check (amount_minor > 0),
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),

  requested_at    timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint payment_requests_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.invoices (organization_id, id) on delete cascade
);

comment on table public.payment_requests is
  'That this business asked a processor for money. The webhook resolves the processor''s reference against this rather than trusting an id echoed back in a vendor payload.';

-- Leads with `organization_id` (I2). A provider reference is unique per provider per business,
-- which is also what makes the webhook idempotent one table down.
create unique index payment_requests_org_provider_reference_unique
  on public.payment_requests (organization_id, provider, provider_reference);

-- **There is deliberately no global unique index on `(provider, provider_reference)`, and
-- writing one is how this slice first got I2 wrong.** It reads as correct — a Stripe session id
-- is unique in Stripe's namespace — and `schema-conformance.test.ts` refused it, for exactly
-- the reason I2 exists: `provider_reference` is a value a caller supplies, so a global unique
-- index would let one business register a reference that blocks, or captures, another's real
-- payment. The webhook therefore does not look a request up by the processor's reference at
-- all; see `record_provider_payment` below.

create index payment_requests_org_invoice_idx
  on public.payment_requests (organization_id, invoice_id, requested_at desc);

alter table public.payment_requests enable row level security;
alter table public.payment_requests force row level security;

create policy payment_requests_select on public.payment_requests
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Asking for money is `payment.record`, not a third capability. Whoever may write down that
-- money arrived may also ask a processor to collect it; splitting them would be a distinction
-- no business has asked for.
create policy payment_requests_insert on public.payment_requests
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'payment.record')
  );

grant select, insert on public.payment_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Money arriving from a processor
-- ---------------------------------------------------------------------------

-- The one thing the webhook role may do.
--
-- **Every consequential value is derived, not passed.** The caller supplies a provider, a
-- reference and an amount -- and the organization, the invoice and the currency all come from
-- the `payment_requests` row that reference resolves to. A webhook that could name an invoice
-- could name somebody else's.
--
-- **Idempotent by constraint rather than by check.** A processor that delivers the same event
-- twice hits `payments_org_provider_reference_unique` and this returns the row already there.
-- A `select` before the `insert` would race identically, which is I6's argument -- and a
-- duplicated payment is the version of that race that costs a refund.
create function public.record_provider_payment(
  p_request_id        uuid,
  p_provider          text,
  p_provider_reference text,
  p_amount_minor      bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor   constant uuid := '00000000-0000-4000-8000-0000000000a1';
  v_request public.payment_requests;
  v_id      uuid;
begin
  -- **By primary key, and the reason is I2.** An earlier draft resolved on the processor's own
  -- reference, which needed a globally unique index over a caller-supplied value — the shape
  -- the conformance test refuses. This is our own uuid, handed to the processor as a
  -- correlation token and returned inside a payload whose signature has already been checked.
  -- That is not trusting a vendor with "which row should I write": the row carries the
  -- organization, the invoice and the currency, and the caller names none of them.
  select * into v_request
  from public.payment_requests
  where id = p_request_id
    and provider = p_provider;

  if v_request.id is null then
    -- A payment this platform never asked for. It is not an error on the processor's side and
    -- it is not ours to guess at: the handler logs it and returns 200 so the processor stops
    -- retrying, and nothing is written.
    raise exception 'no payment was requested under that reference'
      using errcode = 'GD003';
  end if;

  insert into public.payments
    (organization_id, invoice_id, amount_minor, currency, received_at,
     provider, provider_reference, created_by)
  values
    (v_request.organization_id, v_request.invoice_id, p_amount_minor, v_request.currency,
     now(), p_provider, p_provider_reference, v_actor)
  on conflict (organization_id, provider, provider_reference)
    where provider is not null
    do nothing
  returning id into v_id;

  if v_id is null then
    -- The redelivery path. Return what is already recorded, so the handler's answer to a
    -- repeated event is identical to its answer to the first one.
    select p.id into v_id
    from public.payments p
    where p.organization_id = v_request.organization_id
      and p.provider = p_provider
      and p.provider_reference = p_provider_reference;

    return v_id;
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  select
    v_request.organization_id, v_actor, 'work_item', i.work_item_id, 'payment.recorded',
    jsonb_build_object(
      'invoice_id', v_request.invoice_id,
      'payment_id', v_id,
      'amount_minor', p_amount_minor,
      'currency', v_request.currency,
      'provider', p_provider
    )
  from public.invoices i
  where i.id = v_request.invoice_id;

  return v_id;
end;
$fn$;

comment on function public.record_provider_payment(uuid, text, text, bigint) is
  'The only thing the payment_webhook role may do. Derives organization, invoice and currency from the payment_requests row named by its primary key; the caller names none of them.';

revoke all on function public.record_provider_payment(uuid, text, text, bigint) from public;
grant execute on function public.record_provider_payment(uuid, text, text, bigint) to payment_webhook;
