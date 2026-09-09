import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * D41, built: what a business has bought, and what it is entitled to use right now — the
 * wanted∩paid intersection, computed rather than stored. `organization_modules` still answers
 * "does this business want this module"; this file is the "has it paid for it" half.
 */

export type CommercialTerm = {
  id: string;
  organizationId: string;
  productKey: string;
  periodStart: string;
  periodEnd: string;
  quantity: number;
  priceMinor: number;
  currency: string | null;
  recordedAt: string;
  note: string;
};

export type ModuleCommercialState = {
  moduleKey: string;
  wanted: boolean;
  paid: boolean;
  periodEnd: string | null;
};

/** What a business bought — visible to the business itself, and to platform staff for any tenant. */
export async function listOrganizationTerms(
  db: Db,
  input: { organizationId: string },
): Promise<CommercialTerm[]> {
  const { data, error } = await db
    .from('organization_commercial_terms')
    .select('id, organization_id, product_key, period_start, period_end, quantity, price_minor, currency, recorded_at, note')
    .eq('organization_id', input.organizationId)
    .order('period_start', { ascending: false });

  if (error) throw new DomainError(error.message, 'commercial.terms_failed');

  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    productKey: row.product_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    quantity: row.quantity,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
    recordedAt: row.recorded_at,
    note: row.note,
  }));
}

/** The four D41 states, minus "absent" — a module in neither set produces no row (nothing to explain). */
export async function moduleCommercialState(
  db: Db,
  input: { organizationId: string },
): Promise<ModuleCommercialState[]> {
  const { data, error } = await db.rpc('module_commercial_state', {
    p_organization_id: input.organizationId,
  });

  if (error) throw new DomainError(error.message, 'commercial.module_state_failed');

  return (data ?? []).map((row) => ({
    moduleKey: row.module_key,
    wanted: row.wanted,
    paid: row.paid,
    periodEnd: row.period_end,
  }));
}

export type RecordTermInput = {
  organizationId: string;
  productKey: string;
  periodStart: string;
  periodEnd: string;
  priceMinor: number;
  currency?: string;
  quantity?: number;
  note?: string;
};

/** Staff only — `public.record_commercial_term` is the one door onto this table (D41's own rule). */
export async function recordCommercialTerm(db: Db, input: RecordTermInput): Promise<string> {
  const { data, error } = await db.rpc('record_commercial_term', {
    p_organization_id: input.organizationId,
    p_product_key: input.productKey,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_price_minor: input.priceMinor,
    p_currency: input.currency,
    p_quantity: input.quantity ?? 1,
    p_note: input.note ?? '',
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff may record a term.', 'commercial.forbidden');
    }
    if (error.code === '23P01') {
      throw new DomainError(
        'This business already has a term for that product covering part of this period.',
        'commercial.term_overlap',
      );
    }
    throw new DomainError(error.message, 'commercial.record_term_failed');
  }

  return data as string;
}
