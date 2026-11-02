-- An accepted proposal can become an invoice: the expand half (ADR-051, third slice).
--
-- Two things, both safe with every application instance already running.
--
-- 1. A proposal's status only moves forward, and its terms never move at all. Until now the
--    status-only update grant let a seller set `status` to anything while a proposal was draft or
--    sent -- back to draft after the customer had it, or straight to `accepted` without the
--    customer. An invoice is about to be issued from `accepted`, so acceptance has to mean the
--    customer accepted. A trigger now holds every update to the transitions the product has:
--    draft -> sent by the seller (the one direct update the application makes), and
--    sent -> accepted / declined only inside the customer's own functions. Corrected terms are a
--    new version from `build_catalog_proposal`, as they always were meant to be.
--
-- 2. `invoices.source` learns `proposal`, with the proposal it came from, and the readers report
--    it. Nothing writes such an invoice yet: the writer, `issue_invoice_from_proposal`, is
--    `20261031000008`, applied only once every running instance reads this source (an older one
--    refuses an unknown source when it reads an invoice list).

-- ---------------------------------------------------------------------------------------------
-- A proposal moves forward only
-- ---------------------------------------------------------------------------------------------

create function app.guard_commercial_proposal_update()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- The terms as built. Never edited in place, by anyone: a correction is a new version.
  if (new.organization_id, new.customer_id, new.basis, new.plan_id, new.plan_label, new.currency,
      new.billing_interval, new.plan_price_minor, new.addon_price_minor, new.discount_minor,
      new.discount_reason, new.notes, new.catalog_total_minor, new.version, new.supersedes_id,
      new.created_at, new.created_by, new.proposed_configuration)
     is distinct from
     (old.organization_id, old.customer_id, old.basis, old.plan_id, old.plan_label, old.currency,
      old.billing_interval, old.plan_price_minor, old.addon_price_minor, old.discount_minor,
      old.discount_reason, old.notes, old.catalog_total_minor, old.version, old.supersedes_id,
      old.created_at, old.created_by, old.proposed_configuration) then
    raise exception 'a proposal''s terms never change; build a new version instead'
      using errcode = 'GD021';
  end if;

  if new.status = old.status then
    if (new.accepted_by, new.accepted_at, new.accepted_configuration, new.declined_by, new.declined_at)
       is distinct from
       (old.accepted_by, old.accepted_at, old.accepted_configuration, old.declined_by, old.declined_at) then
      raise exception 'a proposal''s response is recorded once' using errcode = 'GD021';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'sent' then
    if (new.accepted_by, new.accepted_at, new.declined_by, new.declined_at) is distinct from
       (old.accepted_by, old.accepted_at, old.declined_by, old.declined_at) then
      raise exception 'sending a proposal records no response' using errcode = 'GD021';
    end if;
    return new;
  end if;

  -- The customer's answer. Reachable only through `accept_commercial_proposal` and
  -- `decline_commercial_proposal`, which run as their owner and check the customer and the link;
  -- a signed-in client updating the row directly runs as `authenticated` and is refused here.
  if old.status = 'sent' and new.status in ('accepted', 'declined')
     and current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  raise exception 'a proposal cannot move from % to %', old.status, new.status
    using errcode = 'GD021';
end;
$fn$;

revoke all on function app.guard_commercial_proposal_update() from public, anon, authenticated;

create trigger customer_commercial_proposals_forward_only
  before update on public.customer_commercial_proposals
  for each row execute function app.guard_commercial_proposal_update();

-- ---------------------------------------------------------------------------------------------
-- The proposal source
-- ---------------------------------------------------------------------------------------------

alter table public.invoices drop constraint invoices_source_known;
alter table public.invoices
  add constraint invoices_source_known check (source in ('work_item', 'direct', 'proposal'));

-- Restrict, not cascade: once a proposal has been invoiced, the proposal is the invoice's record of
-- what was agreed, and deleting it would leave the invoice pointing nowhere.
alter table public.invoices
  add column proposal_id uuid,
  add constraint invoices_proposal_fk
    foreign key (organization_id, proposal_id)
    references public.customer_commercial_proposals (organization_id, id) on delete restrict;

comment on column public.invoices.proposal_id is
  'The accepted catalog proposal this invoice was issued from. Set exactly when source = proposal; one invoice per proposal.';

alter table public.invoices drop constraint invoices_source_reference;
alter table public.invoices
  add constraint invoices_source_reference check (
    (source = 'work_item' and work_item_id is not null and proposal_id is null
       and issuance_key is null and issuance_fingerprint is null)
    or
    (source = 'direct' and work_item_id is null and proposal_id is null
       and issuance_key is not null and issuance_fingerprint is not null)
    or
    (source = 'proposal' and work_item_id is null and proposal_id is not null
       and issuance_key is not null and issuance_fingerprint is not null)
  );

-- One complete invoice per accepted proposal (V1: no staged or partial invoicing).
create unique index invoices_org_proposal_unique
  on public.invoices (organization_id, proposal_id)
  where proposal_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------------------------

-- Appended, so every existing reader's shape is unchanged. Totals, payments, outstanding and
-- overdue are already source-blind; `invoiced_and_incurred` and both payment writers already treat
-- an invoice with no Work by its own customer and its own id (20261031000003), so a proposal
-- invoice needs nothing more from them.
create or replace view public.finance_invoice_records with (security_invoker = true) as
 select i.id,
    i.organization_id,
    i.work_item_id,
    i.customer_id,
    i.billed_to,
    i.number,
    i.currency,
    i.issued_at,
    i.due_at,
    i.created_by,
    t.total_minor,
    coalesce(p.paid_minor, 0::bigint) as paid_minor,
    t.total_minor - coalesce(p.paid_minor, 0::bigint) as outstanding_minor,
    t.total_minor <= coalesce(p.paid_minor, 0::bigint) as settled,
    t.total_minor > coalesce(p.paid_minor, 0::bigint) and i.due_at < now() as overdue,
    i.source,
    i.proposal_id
   from public.invoices i
     join lateral ( select sum(l.unit_amount_minor * l.quantity)::bigint as total_minor
           from public.invoice_lines l
          where l.organization_id = i.organization_id and l.invoice_id = i.id) t on true
     left join lateral ( select sum(p_1.amount_minor)::bigint as paid_minor
           from public.payments p_1
          where p_1.organization_id = i.organization_id and p_1.invoice_id = i.id) p on true;
