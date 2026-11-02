-- An accepted catalog proposal is invoiced, once and completely (ADR-051, third slice).
--
-- The writer half. `20261031000007` taught the schema and every reader the `proposal` source; this
-- is applied only after every running application instance reads it (docs/deployment.md).
--
-- The caller names the proposal, optional dates and an issuance key, and nothing else: not the
-- business, not the customer, not a line, not a price. Everything on the invoice is copied from
-- the accepted proposal's own lines -- the prices the customer agreed to -- and never from the
-- catalog as it reads today. Acceptance still issues nothing by itself; a person with
-- `invoice.issue` asks for this. It records no payment and provisions nothing.

create function public.issue_invoice_from_proposal(
  p_proposal_id  uuid,
  p_issued_at    timestamptz,
  p_due_at       timestamptz,
  p_issuance_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := (select auth.uid());
  v_proposal    public.customer_commercial_proposals;
  v_customer    text;
  v_issued      timestamptz := coalesce(p_issued_at, now());
  v_fingerprint text;
  v_existing    public.invoices;
  v_number      integer;
  v_invoice     uuid;
  v_lines       integer;
  v_sum         numeric;
  v_wrong       integer;
begin
  if v_actor is null then
    raise exception 'issue_invoice_from_proposal requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The business is the proposal's, never an argument. Another business's proposal reads the
  -- same as no proposal at all.
  select * into v_proposal from public.customer_commercial_proposals where id = p_proposal_id;
  if v_proposal.id is null
     or v_proposal.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_proposal.organization_id, 'invoice.issue') then
    raise exception 'no such proposal, or you may not invoice it'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.usable_modules(v_proposal.organization_id) m where m = 'billing') then
    raise exception 'billing is not available for this business'
      using errcode = '42501';
  end if;

  if p_issuance_key is null then
    raise exception 'an issuance needs its own key, so a retry is the same request'
      using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at < v_issued then
    raise exception 'the due date is before the invoice date'
      using errcode = '22023';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'proposal', p_proposal_id, 'issued_at', p_issued_at, 'due_at', p_due_at
  )::text);

  -- Serializes this business's issuance, from every source, until commit: the retry and
  -- already-invoiced checks below cannot race a concurrent request, and the number is the next one.
  v_number := app.allocate_invoice_number(v_proposal.organization_id);

  select * into v_existing
    from public.invoices i
   where i.organization_id = v_proposal.organization_id
     and i.issuance_key = p_issuance_key;
  if v_existing.id is not null then
    if v_existing.issuance_fingerprint = v_fingerprint then
      return v_existing.id;
    end if;
    raise exception 'that issuance key was already used for a different invoice'
      using errcode = 'GD014';
  end if;

  if exists (
    select 1 from public.invoices i
     where i.organization_id = v_proposal.organization_id
       and i.proposal_id = p_proposal_id
  ) then
    raise exception 'this proposal has already been invoiced'
      using errcode = 'GD015';
  end if;

  -- V1: an accepted, one-off catalog proposal, invoiced whole. A Platform Plan proposal is GildOps
  -- provisioning, not a sale this business invoices; recurring terms have nothing to bill them yet.
  if v_proposal.status <> 'accepted'
     or v_proposal.basis <> 'catalog'
     or v_proposal.billing_interval <> 'one_time' then
    raise exception 'only an accepted one-off catalog proposal can be invoiced'
      using errcode = 'GD019';
  end if;

  -- The snapshot must agree with itself. A disagreement is refused, never repriced.
  select count(*), sum(l.amount_minor),
         count(*) filter (where l.currency <> v_proposal.currency
                             or l.amount_minor <> l.quantity::bigint * l.unit_amount_minor)
    into v_lines, v_sum, v_wrong
    from public.customer_commercial_proposal_lines l
   where l.organization_id = v_proposal.organization_id
     and l.proposal_id = p_proposal_id;
  if v_lines < 1 or v_wrong > 0 or v_sum is distinct from v_proposal.catalog_total_minor then
    raise exception 'this proposal''s lines do not add up to its accepted total'
      using errcode = 'GD020';
  end if;

  select coalesce(nullif(btrim(c.name), ''), 'Customer') into v_customer
    from public.contacts c
   where c.organization_id = v_proposal.organization_id
     and c.id = v_proposal.customer_id;

  insert into public.invoices
    (organization_id, source, work_item_id, proposal_id, customer_id, billed_to, number, currency,
     issued_at, due_at, created_by, issuance_key, issuance_fingerprint)
  values
    (v_proposal.organization_id, 'proposal', null, p_proposal_id, v_proposal.customer_id,
     left(coalesce(v_customer, 'Customer'), 200), v_number, v_proposal.currency,
     v_issued, p_due_at, v_actor, p_issuance_key, v_fingerprint)
  returning id into v_invoice;

  -- The copy, in the proposal's own order.
  insert into public.invoice_lines
    (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
  select
    l.organization_id, v_invoice, l.name, l.unit, l.unit_amount_minor, l.currency, l.quantity,
    row_number() over (order by l.position)
  from public.customer_commercial_proposal_lines l
  where l.organization_id = v_proposal.organization_id
    and l.proposal_id = p_proposal_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_proposal.organization_id, v_actor, 'invoice', v_invoice, 'invoice.issued',
     jsonb_build_object(
       'invoice_id', v_invoice,
       'number', v_number,
       'currency', v_proposal.currency,
       'issued_at', v_issued,
       'source', 'proposal',
       'proposal_id', p_proposal_id,
       'customer_id', v_proposal.customer_id
     ));

  return v_invoice;
end;
$fn$;

comment on function public.issue_invoice_from_proposal(uuid, timestamptz, timestamptz, uuid) is
  'Issue one complete invoice from an accepted one-off catalog proposal, copying the proposal''s own lines. The caller supplies the proposal, optional dates and an issuance key only. Retrying with the same key returns the same invoice; a proposal is invoiced at most once. Records no payment and grants nothing.';

revoke all on function public.issue_invoice_from_proposal(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.issue_invoice_from_proposal(uuid, timestamptz, timestamptz, uuid) to authenticated;
