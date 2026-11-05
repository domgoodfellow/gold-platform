'use client';

import { useActionState, useState } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { ErrorText, FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import {
  commercialProposalTotalMinor,
  type CommercialProposal,
  type CommercialProposalStatus,
} from '@/lib/domain/customers/commercial-proposals';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { ProposalInvite } from '@/lib/domain/customers/proposal-invites';
import type { AcceptedProposalHandoff } from '@/lib/domain/customers/proposal-handoff';
import { InvoiceDialog } from '@/features/finance/transactions/invoice-dialog';
import { invoiceHref } from '@/features/finance/collections/finance-tables';
import {
  buildCommercialProposalAction,
  sendCommercialProposalAction,
  sendProposalInviteAction,
  handoffProposalAction,
  type BuildCommercialProposalState,
  type SendCommercialProposalState,
  type SendProposalInviteState,
  type HandoffProposalState,
} from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions';
import { SelectField } from '@/components/controls/select-field';

const BUILD_INITIAL: BuildCommercialProposalState = { error: null, created: false };
const SEND_INITIAL: SendCommercialProposalState = { error: null };
const INVITE_INITIAL: SendProposalInviteState = { error: null, url: null };
const HANDOFF_INITIAL: HandoffProposalState = { error: null, createdOrganizationId: null };

const STATUS_TONE: Record<CommercialProposalStatus, 'neutral' | 'accent' | 'success'> = {
  draft: 'neutral',
  sent: 'accent',
  accepted: 'success',
  declined: 'neutral',
};

/** The terms exactly as built: copied catalog lines, or a legacy Platform Plan with its add-ons and discount. */
export function ProposalTerms({ proposal }: { proposal: CommercialProposal }) {
  if (proposal.basis === 'catalog') {
    return (
      <>
        <ul className="mt-2 flex flex-col gap-0.5">
          {proposal.lines.map((line) => (
            <li key={line.position} className="text-sm">
              {line.name} — {line.quantity} {line.unit} × {formatMoney(line.unitAmountMinor, line.currency)} = {formatMoney(line.amountMinor, line.currency)}
            </li>
          ))}
        </ul>
        <div className="mt-2 text-sm font-medium">Total: {formatMoney(commercialProposalTotalMinor(proposal), proposal.currency)}, one-off</div>
      </>
    );
  }
  return (
    <>
      <div className="mt-2 text-sm">{proposal.planLabel} — {formatMoney(proposal.planPriceMinor, proposal.currency)}/{proposal.billingInterval}</div>
      {proposal.addons.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {proposal.addons.map((addon) => (
            <li key={addon.addonPlanId} className="pl-3 text-sm text-subtle">
              {addon.label} — {formatMoney(addon.priceMinor, proposal.currency)}/{proposal.billingInterval}
            </li>
          ))}
        </ul>
      ) : null}
      {proposal.discountMinor > 0 ? (
        <div className="mt-1 text-sm text-subtle">
          Discount: -{formatMoney(proposal.discountMinor, proposal.currency)} ({proposal.discountReason})
        </div>
      ) : null}
      <div className="mt-2 text-sm font-medium">
        Total: {formatMoney(commercialProposalTotalMinor(proposal), proposal.currency)}/{proposal.billingInterval}
      </div>
    </>
  );
}

/** Who may issue an invoice from an accepted proposal here: `invoice.issue` with Billing usable. Null hides the control; the database refuses anyone else regardless. */
export type ProposalInvoicing = { today: string; customerName: string } | null;

function ProposalRow({ proposal, organizationId, customerId, mayEdit, mayHandoff, handoff, accessibleTenantIds, invoice, invoicing }: {
  proposal: CommercialProposal;
  organizationId: string;
  customerId: string;
  mayEdit: boolean;
  mayHandoff: boolean;
  handoff: AcceptedProposalHandoff | undefined;
  accessibleTenantIds: string[];
  invoice: { id: string; number: number } | undefined;
  invoicing: ProposalInvoicing;
}) {
  const [state, formAction, pending] = useActionState(sendCommercialProposalAction, SEND_INITIAL);
  const [handoffState, handoffFormAction, handoffPending] = useActionState(handoffProposalAction, HANDOFF_INITIAL);
  const createdOrganizationId = handoff?.createdOrganizationId ?? handoffState.createdOrganizationId;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Version {proposal.version}</span>
        <Badge tone={STATUS_TONE[proposal.status]}>{proposal.status}</Badge>
      </div>
      <ProposalTerms proposal={proposal} />
      {proposal.notes ? <p className="mt-2 text-sm text-subtle">{proposal.notes}</p> : null}
      {proposal.status === 'accepted' && proposal.acceptedAt ? (
        <Hint className="mt-2">
          Accepted {new Date(proposal.acceptedAt).toLocaleString()}. The customer agreed to this version at these prices.{invoice ? '' : ' Nothing has been invoiced or charged.'}
        </Hint>
      ) : null}
      {proposal.status === 'accepted' && proposal.basis === 'catalog' && proposal.billingInterval === 'one_time' ? (
        invoice ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Hint>Invoiced as #{invoice.number}.</Hint>
            <ButtonLink href={invoiceHref(organizationId, { id: invoice.id, workItemId: null })} tone="secondary" size="small">View invoice</ButtonLink>
          </div>
        ) : invoicing ? (
          <div className="mt-3">
            <InvoiceDialog organizationId={organizationId} today={invoicing.today} label="Create invoice" ariaLabel={`Create invoice from version ${proposal.version}`}
              proposal={{ id: proposal.id, version: proposal.version, customerName: invoicing.customerName, lines: proposal.lines.map((line) => ({ id: `${proposal.id}:${line.position}`, description: line.name, unit: line.unit, unitAmountMinor: line.unitAmountMinor, currency: line.currency, quantity: line.quantity })) }} />
          </div>
        ) : null
      ) : null}
      {proposal.status === 'declined' && proposal.declinedAt ? <Hint className="mt-2">Declined {new Date(proposal.declinedAt).toLocaleString()}.</Hint> : null}

      {mayEdit && proposal.status === 'draft' ? (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <Button type="submit" tone="secondary" disabled={pending}>
            Mark sent
          </Button>
          {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        </form>
      ) : null}

      {proposal.status === 'accepted' && proposal.basis === 'platform_plan' && mayHandoff ? (
        createdOrganizationId ? (
          <Hint className="mt-3">
            Business created.{' '}
            {accessibleTenantIds.includes(createdOrganizationId) ? <a href={`/organizations/${createdOrganizationId}`} className="underline underline-offset-4">
              Open it
            </a> : null}
          </Hint>
        ) : (
          <form action={handoffFormAction} className="mt-3">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="proposalId" value={proposal.id} />
            <Button type="submit" disabled={handoffPending}>
              {handoffPending ? 'Creating…' : 'Create this business in GildOps'}
            </Button>
            {handoffState.error ? <ErrorText>{handoffState.error}</ErrorText> : null}
          </form>
        )
      ) : null}
    </div>
  );
}

type DraftLine = { key: number; priceBookItemId: string; quantity: string };

/**
 * Lines are catalog items and whole quantities. The amounts shown are a preview from the catalog
 * as this page read it; the proposal records the prices the database copies when it is built.
 */
function CatalogProposalBuilder({ organizationId, customerId, items, currency }: {
  organizationId: string;
  customerId: string;
  items: PriceBookItem[];
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(buildCommercialProposalAction, BUILD_INITIAL);
  const [lines, setLines] = useState<DraftLine[]>([{ key: 0, priceBookItemId: '', quantity: '1' }]);
  const sellable = items.filter((item) => item.currency === currency);
  const byId = new Map(sellable.map((item) => [item.id, item]));
  const previewMinor = lines.reduce((sum, line) => {
    const item = byId.get(line.priceBookItemId);
    const quantity = Number(line.quantity);
    return item && Number.isInteger(quantity) && quantity > 0 ? sum + item.unitAmountMinor * quantity : sum;
  }, 0);
  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  if (sellable.length === 0) {
    return (
      <Hint className="mt-6 border-t border-border pt-4">
        Add an item priced in {currency || 'your trading currency'} to Catalog & Pricing to build a proposal.
      </Hint>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="customerId" value={customerId} />
      <h3 className="text-sm font-medium">New version</h3>
      {lines.map((line, index) => (
        <div key={line.key} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 grow basis-56 flex-col gap-1 sm:max-w-sm">
            <FieldLabel htmlFor={`proposal-item-${line.key}`}>{`Item ${index + 1}`}</FieldLabel>
            <SelectField id={`proposal-item-${line.key}`} name="priceBookItemId" value={line.priceBookItemId} onValueChange={(next) => update(line.key, { priceBookItemId: next })} required options={[{ value: '', label: 'Choose an item' }, ...sellable.map((item) => ({ value: item.id, label: `${item.name} — ${formatMoney(item.unitAmountMinor, item.currency)} / ${item.unit}` }))]} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`proposal-quantity-${line.key}`}>{`Quantity ${index + 1}`}</FieldLabel>
            <TextInput
              id={`proposal-quantity-${line.key}`}
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000000}
              step={1}
              value={line.quantity}
              onChange={(event) => update(line.key, { quantity: event.target.value })}
              className="w-24"
              required
            />
          </div>
          {lines.length > 1 ? (
            <Button type="button" tone="secondary" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
              Remove
            </Button>
          ) : null}
        </div>
      ))}
      {lines.length < 100 ? (
        <Button
          type="button"
          tone="secondary"
          className="w-fit"
          onClick={() => setLines((current) => [...current, { key: Math.max(...current.map((entry) => entry.key)) + 1, priceBookItemId: '', quantity: '1' }])}
        >
          Add line
        </Button>
      ) : null}

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="notes">Notes</FieldLabel>
        <TextArea id="notes" name="notes" rows={3} maxLength={4000} />
      </div>

      <Hint>Total at today’s catalog prices: {formatMoney(previewMinor, currency)}, one-off. The prices are fixed when the version is built.</Hint>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Building…' : 'Build proposal'}
      </Button>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

function ProposalInviteRow({ invite, origin }: { invite: ProposalInvite; origin: string }) {
  const url = `${origin}/proposal/${invite.token}`;
  return (
    <li className="text-sm">
      {invite.revokedAt ? (
        <span className="break-all text-subtle line-through">{url}</span>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4">
          {url}
        </a>
      )}
    </li>
  );
}

/**
 * A commercial proposal is a distinct, versioned commitment — never `configuration_proposals`
 * (which needs an organization to already exist) and never a live join to the catalog a later
 * change could reprice underneath a customer's own copy. Every version stays visible; a
 * changed term is a new one, not an edit. New versions are built from the business's own
 * catalog; Platform Plan versions built before that remain as they were.
 */
export function CommercialProposalSection({
  organizationId,
  customerId,
  proposals,
  invites,
  handoffsByProposalId,
  mayHandoff,
  origin,
  catalogItems,
  mayBuild,
  mayEdit,
  role,
  currency,
  accessibleTenantIds = [],
  invoicesByProposalId = {},
  invoicing = null,
}: {
  organizationId: string;
  customerId: string;
  proposals: CommercialProposal[];
  invites: ProposalInvite[];
  handoffsByProposalId: Record<string, AcceptedProposalHandoff>;
  mayHandoff: boolean;
  origin: string;
  catalogItems: PriceBookItem[];
  /** `price.manage` in a business whose catalog (the Billing module) is usable. */
  mayBuild: boolean;
  mayEdit: boolean;
  role: string;
  currency: string;
  accessibleTenantIds?: string[];
  /** The invoice issued from each accepted proposal, at most one each. */
  invoicesByProposalId?: Record<string, { id: string; number: number }>;
  invoicing?: ProposalInvoicing;
}) {
  const [inviteState, inviteFormAction, invitePending] = useActionState(sendProposalInviteAction, INVITE_INITIAL);
  const hasSendableProposal = proposals.some((proposal) => proposal.status !== 'draft');

  return (
    <Section>
      <SectionHeading>Commercial proposal</SectionHeading>

      <div className="mt-4 flex flex-col gap-3">
        {proposals.length === 0 ? (
          <Hint>No proposal built yet.</Hint>
        ) : (
          proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              organizationId={organizationId}
              customerId={customerId}
              mayEdit={mayEdit}
              mayHandoff={mayHandoff}
              accessibleTenantIds={accessibleTenantIds}
              handoff={handoffsByProposalId[proposal.id]}
              invoice={invoicesByProposalId[proposal.id]}
              invoicing={invoicing}
            />
          ))
        )}
      </div>

      {mayEdit && hasSendableProposal ? (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Proposal links</h3>
          {invites.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {invites.map((invite) => (
                <ProposalInviteRow key={invite.id} invite={invite} origin={origin} />
              ))}
            </ul>
          ) : (
            <Hint className="mt-1">No link sent yet.</Hint>
          )}
          <form action={inviteFormAction} className="mt-2">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="customerId" value={customerId} />
            <Button type="submit" tone="secondary" disabled={invitePending}>
              Create a link
            </Button>
            {inviteState.error ? <ErrorText>{inviteState.error}</ErrorText> : null}
          </form>
        </div>
      ) : null}

      {mayBuild ? (
        <CatalogProposalBuilder organizationId={organizationId} customerId={customerId} items={catalogItems} currency={currency} />
      ) : mayEdit ? null : (
        <Hint className="mt-4">Your role, {role}, cannot build a commercial proposal.</Hint>
      )}
    </Section>
  );
}
