import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCallingOptions } from '@/lib/application/communications/calling-options';
import type { Db } from '@/lib/db/types';

const reads = vi.hoisted(() => ({ features: vi.fn(), runtime: vi.fn(), readiness: vi.fn(), numbers: vi.fn(), usual: vi.fn() }));
vi.mock('@/lib/domain/catalogue/organization-plans', () => ({ organizationResolvedFeatureStates: reads.features, availableFeatureKeys: (keys: string[]) => new Set(keys) }));
vi.mock('@/lib/application/communications/calling-runtime', () => ({ callingRuntimeConfigured: reads.runtime }));
vi.mock('@/lib/domain/reception/provider-readiness', () => ({ communicationsProviderReadiness: reads.readiness }));
vi.mock('@/lib/domain/reception/numbers', () => ({ listPhoneNumbers: reads.numbers, resolveOutboundNumber: reads.usual }));
const db = {} as Db;
const number = { id: 'ready', e164: '+14165550101', label: 'Office', voiceOutboundEnabled: true, readiness: 'ready', lifecycle: 'active', origin: 'provisioned' };
beforeEach(() => {
  vi.clearAllMocks();
  reads.features.mockResolvedValue(['outbound_calling']); reads.runtime.mockReturnValue(true); reads.readiness.mockResolvedValue('ready');
  reads.numbers.mockResolvedValue([number]); reads.usual.mockResolvedValue({ phoneNumberId: number.id, e164: number.e164 });
});
describe('calling options admission', () => {
  it('loads no catalogue, provider or number data without call permission', async () => {
    const result = await loadCallingOptions(db, { organizationId: 'tenant', mayCall: false });
    expect(result.numbers).toEqual([]); expect(result.unavailableReason).toMatch(/role/);
    Object.values(reads).forEach(read => expect(read).not.toHaveBeenCalled());
  });
  it.each(['entitlement', 'runtime', 'binding'])('does not expose numbers when %s is unavailable', async blocker => {
    if (blocker === 'entitlement') reads.features.mockResolvedValue([]);
    if (blocker === 'runtime') reads.runtime.mockReturnValue(false);
    if (blocker === 'binding') reads.readiness.mockResolvedValue('error');
    const result = await loadCallingOptions(db, { organizationId: 'tenant', mayCall: true });
    expect(result.numbers).toEqual([]); expect(result.defaultNumber).toBeNull(); expect(result.unavailableReason).toBeTruthy();
    expect(reads.numbers).not.toHaveBeenCalled(); expect(reads.usual).not.toHaveBeenCalled();
  });
  it('returns only ready outbound identities and the resolved eligible default', async () => {
    reads.numbers.mockResolvedValue([number, { ...number, id: 'inactive', lifecycle: 'inactive' }, { ...number, id: 'browser', origin: 'browser' }, { ...number, id: 'unready', readiness: 'degraded' }, { ...number, id: 'inbound-only', voiceOutboundEnabled: false }]);
    const result = await loadCallingOptions(db, { organizationId: 'tenant', mayCall: true });
    expect(result).toEqual({ numbers: [{ id: number.id, e164: number.e164, label: number.label }], defaultNumber: { id: number.id, e164: number.e164, label: number.label }, unavailableReason: null });
    expect(reads.numbers).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: 'tenant' }));
  });
});
