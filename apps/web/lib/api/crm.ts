import { callDomainCommand } from './client';

/**
 * Moving a customer along the pipeline, authoritative in `apps/api/app/domains/crm/stages.py`.
 *
 * **Distinct from `updateCustomer` (lib/domain/customers/customers.ts), which remains
 * authoritative for its own act** — correcting a customer's details in one sitting, with the
 * stage carried along because that screen's own reason for bundling them still holds. This is
 * the write behind the pipeline board's own stage control, a different act with a different
 * shape (see `apps/api/app/domains/crm/stages.py`'s own comment for why both remain).
 */
export type ChangeCustomerStageResult = {
  customerId: string;
  stageId: string | null;
};

export async function changeCustomerStage(input: {
  token: string;
  organizationId: string;
  customerId: string;
  stageId: string | null;
}): Promise<ChangeCustomerStageResult> {
  const result = await callDomainCommand<{ customer_id: string; stage_id: string | null }>(
    '/crm/change-customer-stage',
    {
      token: input.token,
      body: {
        organization_id: input.organizationId,
        customer_id: input.customerId,
        stage_id: input.stageId,
      },
    },
  );

  return { customerId: result.customer_id, stageId: result.stage_id };
}
