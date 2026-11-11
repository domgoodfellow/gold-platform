import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callingRuntimeConfigured } from '@/lib/application/communications/calling-runtime';
import type { Db } from '@/lib/db/types';

const calls = vi.hoisted(() => ({ telephony: vi.fn() }));
vi.mock('@/lib/domain/reception/calls', () => ({ organizationTelephony: calls.telephony }));

const db = {} as Db;
const organizationId = 'an-organization';

beforeEach(() => {
  vi.clearAllMocks();
  calls.telephony.mockResolvedValue({});
});

describe('calling runtime readiness', () => {
  it('awaits the lookup instead of treating a promise as a telephone', async () => {
    calls.telephony.mockResolvedValue(null);
    expect(await callingRuntimeConfigured(db, { organizationId, mayCall: true })).toBe(false);
  });
  it('is ready when this business has a telephone of its own', async () => {
    expect(await callingRuntimeConfigured(db, { organizationId, mayCall: true })).toBe(true);
    expect(calls.telephony).toHaveBeenCalledWith(db, organizationId);
  });
  it('does not inspect infrastructure without calling permission', async () => {
    expect(await callingRuntimeConfigured(db, { organizationId, mayCall: false })).toBe(false);
    expect(calls.telephony).not.toHaveBeenCalled();
  });
});
