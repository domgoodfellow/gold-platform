import { Client } from 'pg';

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * A Platform Plan proposal as one existed before catalog proposals (ADR-051). No signed-in
 * caller may write one any more (`20261031000006`), so a suite that needs such a row — to prove
 * history still reads, sends, is accepted and hands off — writes it the way it already exists in
 * a hosted database: as stored data. The row is the one the retired builder wrote: the plan's and
 * each add-on's current approved price copied in, the next version for the customer, superseding
 * the latest.
 */
export async function seedLegacyPlanProposal(input: {
  organizationId: string;
  customerId: string;
  createdBy: string;
  planId: string;
  addonPlanIds?: string[];
  currency: string;
  billingInterval: 'month' | 'year' | 'one_time';
  proposedConfiguration?: unknown;
}): Promise<{ id: string; version: number }> {
  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  try {
    await pg.query('begin');
    const price = async (planId: string) => {
      const { rows } = await pg.query<{ label: string; amount_minor: string }>(
        `select p.label, pp.amount_minor
           from public.platform_plans p
           join public.platform_plan_prices pp on pp.plan_id = p.id
          where p.id = $1 and pp.currency = $2 and pp.billing_interval = $3
            and pp.approval_state = 'approved' and pp.effective_from <= now()
            and (pp.effective_to is null or pp.effective_to > now())
          order by pp.effective_from desc limit 1`,
        [planId, input.currency, input.billingInterval],
      );
      if (!rows[0]) throw new Error(`No approved ${input.currency}/${input.billingInterval} price for plan ${planId}.`);
      return { label: rows[0].label, amountMinor: Number(rows[0].amount_minor) };
    };
    const plan = await price(input.planId);
    const addons = await Promise.all((input.addonPlanIds ?? []).map(async (id) => ({ id, ...(await price(id)) })));
    const { rows: previous } = await pg.query<{ id: string; version: number }>(
      `select id, version from public.customer_commercial_proposals
        where organization_id = $1 and customer_id = $2 order by version desc limit 1`,
      [input.organizationId, input.customerId],
    );
    const { rows } = await pg.query<{ id: string; version: number }>(
      `insert into public.customer_commercial_proposals
         (organization_id, customer_id, basis, plan_id, plan_label, currency, billing_interval,
          plan_price_minor, addon_price_minor, version, supersedes_id, proposed_configuration, created_by)
       values ($1, $2, 'platform_plan', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, version`,
      [
        input.organizationId, input.customerId, input.planId, plan.label, input.currency, input.billingInterval,
        plan.amountMinor, addons.reduce((sum, addon) => sum + addon.amountMinor, 0),
        (previous[0]?.version ?? 0) + 1, previous[0]?.id ?? null,
        input.proposedConfiguration === undefined ? null : JSON.stringify(input.proposedConfiguration),
        input.createdBy,
      ],
    );
    for (const addon of addons) {
      await pg.query(
        `insert into public.customer_commercial_proposal_addons (organization_id, proposal_id, addon_plan_id, label, price_minor)
         values ($1, $2, $3, $4, $5)`,
        [input.organizationId, rows[0].id, addon.id, addon.label, addon.amountMinor],
      );
    }
    await pg.query('commit');
    return rows[0];
  } catch (error) {
    await pg.query('rollback');
    throw error;
  } finally {
    await pg.end();
  }
}
