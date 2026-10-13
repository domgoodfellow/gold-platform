'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { ErrorText, FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import {
  commercialProposalTotalMinor,
  type CommercialProposal,
  type CommercialProposalStatus,
} from '@/lib/domain/customers/commercial-proposals';
import type { Plan } from '@/lib/domain/catalogue/plans';
import type { ProposalInvite } from '@/lib/domain/customers/proposal-invites';
import type { AcceptedProposalHandoff } from '@/lib/domain/customers/proposal-handoff';
import {
  buildCommercialProposalAction,
  sendCommercialProposalAction,
  sendProposalInviteAction,
  handoffProposalAction,
  type BuildCommercialProposalState,
  type SendCommercialProposalState,
  type SendProposalInviteState,
  type HandoffProposalState,
} from '@/app/organizations/[organizationId]/customers/[customerId]/actions';

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

function ProposalRow({ proposal, organizationId, customerId, mayEdit, mayHandoff, handoff, accessibleTenantIds }: {
  proposal: CommercialProposal;
  organizationId: string;
  customerId: string;
  mayEdit: boolean;
  mayHandoff: boolean;
  handoff: AcceptedProposalHandoff | undefined;
  accessibleTenantIds: string[];
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
      {proposal.notes ? <p className="mt-2 text-sm text-subtle">{proposal.notes}</p> : null}
      {proposal.status === 'accepted' ? <Hint className="mt-2">Accepted {new Date(proposal.acceptedAt!).toLocaleString()}.</Hint> : null}
      {proposal.status === 'declined' ? <Hint className="mt-2">Declined {new Date(proposal.declinedAt!).toLocaleString()}.</Hint> : null}

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

      {proposal.status === 'accepted' && mayHandoff ? (
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

function ProposalInviteRow({ invite, origin }: { invite: ProposalInvite; origin: string }) {
  const url = `${origin}/proposal/${invite.token}`;
  return (
    <li className="text-sm">
      {invite.revokedAt ? (
        <span className="text-subtle line-through">{url}</span>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          {url}
        </a>
      )}
    </li>
  );
}

/**
 * A commercial proposal is a distinct, versioned commitment — never `configuration_proposals`
 * (which needs an organization to already exist) and never a live join to the price book a later
 * change could reprice underneath a customer's own copy (I8). Every version stays visible; a
 * changed term is a new one, not an edit.
 */
export function CommercialProposalSection({
  organizationId,
  customerId,
  proposals,
  invites,
  handoffsByProposalId,
  mayHandoff,
  origin,
  plans,
  addonPlans,
  mayEdit,
  role,
  currency,
  accessibleTenantIds = [],
}: {
  organizationId: string;
  customerId: string;
  proposals: CommercialProposal[];
  invites: ProposalInvite[];
  handoffsByProposalId: Record<string, AcceptedProposalHandoff>;
  mayHandoff: boolean;
  origin: string;
  plans: Plan[];
  addonPlans: Plan[];
  mayEdit: boolean;
  role: string;
  currency: string;
  accessibleTenantIds?: string[];
}) {
  const [buildState, buildFormAction, buildPending] = useActionState(buildCommercialProposalAction, BUILD_INITIAL);
  const [inviteState, inviteFormAction, invitePending] = useActionState(sendProposalInviteAction, INVITE_INITIAL);
  const hasSendableProposal = proposals.some((proposal) => proposal.status !== 'draft');

  return (
    <Section>
      <SectionHeading>Commercial proposal</SectionHeading>
      <Hint className="mt-1">Every version stays here — a changed term is a new one, never an edit.</Hint>

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

      {mayEdit ? (
        <form action={buildFormAction} className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="customerId" value={customerId} />

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="planId">Plan</FieldLabel>
            <SelectInput id="planId" name="planId" className="w-fit" required>
              <option value="">Choose a plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.label}
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel>Add-ons</FieldLabel>
            <div className="flex flex-col gap-1">
              {addonPlans.map((addon) => (
                <label key={addon.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="addonPlanIds" value={addon.id} />
                  {addon.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="currency">Currency</FieldLabel>
              <TextInput id="currency" name="currency" defaultValue={currency} maxLength={3} className="w-20" required />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="billingInterval">Billing interval</FieldLabel>
              <SelectInput id="billingInterval" name="billingInterval" defaultValue="month">
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
                <option value="one_time">One time</option>
              </SelectInput>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="discountMinor">Discount (minor units)</FieldLabel>
              <TextInput id="discountMinor" name="discountMinor" type="number" min={0} defaultValue={0} className="w-32" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="discountReason">Discount reason</FieldLabel>
              <TextInput id="discountReason" name="discountReason" className="flex-1" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="notes">Notes</FieldLabel>
            <TextArea id="notes" name="notes" rows={3} />
          </div>

          <Button type="submit" disabled={buildPending} className="w-fit">
            Build proposal
          </Button>

          {buildState.error ? <ErrorText>{buildState.error}</ErrorText> : null}
        </form>
      ) : (
        <Hint className="mt-4">Your role, {role}, cannot build a commercial proposal.</Hint>
      )}
    </Section>
  );
}
