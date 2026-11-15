import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callingSetupDoor, loadCallingOptions } from '@/lib/application/communications/calling-options';
import type { Db } from '@/lib/db/types';

const reads = vi.hoisted(() => ({ features: vi.fn(), runtime: vi.fn(), account: vi.fn(), numbers: vi.fn(), options: vi.fn() }));
vi.mock('@/lib/domain/catalogue/organization-plans', () => ({ organizationResolvedFeatureStates: reads.features, availableFeatureKeys: (keys: string[]) => new Set(keys) }));
vi.mock('@/lib/application/communications/calling-runtime', () => ({ callingRuntimeConfigured: reads.runtime }));
vi.mock('@/lib/domain/reception/provider-readiness', () => ({ callingAccountState: reads.account }));
vi.mock('@/lib/domain/reception/numbers', () => ({ listPhoneNumbers: reads.numbers, listOutboundNumberOptions: reads.options }));
const db = {} as Db;
const number = { id: 'ready', e164: '+14165550101', label: 'Office', voiceOutboundEnabled: true, readiness: 'ready', lifecycle: 'active', origin: 'provisioned' };
const option = (id: string, source: string, automatic = false) => ({ phoneNumberId: id, e164: `+1416555${id}`, label: null, source, automatic });
const load = () => loadCallingOptions(db, { organizationId: 'tenant', mayCall: true });

beforeEach(() => {
  vi.clearAllMocks();
  reads.features.mockResolvedValue(['outbound_calling']); reads.runtime.mockResolvedValue(true); reads.account.mockResolvedValue('active');
  reads.numbers.mockResolvedValue([number]); reads.options.mockResolvedValue([option('0101', 'member_default', true)]);
});

describe('calling options admission', () => {
  it('loads no catalogue, provider or number data without call permission', async () => {
    const result = await loadCallingOptions(db, { organizationId: 'tenant', mayCall: false });
    expect(result.numbers).toEqual([]);
    expect(result.blocker).toEqual({ kind: 'restricted', code: 'no-permission', reason: 'Your role cannot place calls.', setup: null });
    Object.values(reads).forEach(read => expect(read).not.toHaveBeenCalled());
  });

  it('says outbound calling is not included, before asking about the account or numbers', async () => {
    reads.features.mockResolvedValue([]);
    expect((await load()).blocker).toMatchObject({ kind: 'not-configured', code: 'not-included', setup: null });
    expect(reads.account).not.toHaveBeenCalled(); expect(reads.options).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', 'no-calling-account', /not set up/],
    ['provisioning', 'calling-account-setting-up', /still being set up/],
    ['failed', 'calling-account-fault', /fault/],
    ['suspended', 'calling-account-suspended', /suspended/],
  ] as const)('words a calling account that is %s as its own state, never as something the business must configure', async (state, code, wording) => {
    reads.account.mockResolvedValue(state);
    const result = await load();
    expect(result.blocker).toMatchObject({ kind: 'unavailable', code, setup: null });
    expect(result.blocker?.reason).toMatch(wording);
    expect(result.numbers).toEqual([]); expect(result.defaultNumber).toBeNull();
    // No number is disclosed, and the service itself is not asked, while the account cannot call.
    expect(reads.runtime).not.toHaveBeenCalled(); expect(reads.numbers).not.toHaveBeenCalled(); expect(reads.options).not.toHaveBeenCalled();
  });

  it('says the service is unavailable when the account is sound and the deployment cannot place calls', async () => {
    reads.runtime.mockResolvedValue(false);
    expect((await load()).blocker).toMatchObject({ kind: 'unavailable', code: 'service-unavailable', setup: null });
    expect(reads.options).not.toHaveBeenCalled();
  });
});

describe('why no outbound number is available', () => {
  beforeEach(() => reads.options.mockResolvedValue([]));

  it('says the business has no numbers', async () => {
    reads.numbers.mockResolvedValue([]);
    expect((await load()).blocker).toEqual({ kind: 'not-configured', code: 'no-numbers', reason: 'This business has no phone numbers.', setup: 'phone-numbers' });
  });

  it.each([
    ['inactive', { lifecycle: 'inactive' }],
    ['not switched on for placing calls', { voiceOutboundEnabled: false }],
    ['an internal browser endpoint', { origin: 'browser' }],
  ])('says no number is switched on for calls when the only number is %s', async (_name, change) => {
    reads.numbers.mockResolvedValue([{ ...number, ...change }]);
    expect((await load()).blocker).toMatchObject({ kind: 'not-configured', code: 'numbers-not-enabled', setup: 'phone-numbers' });
  });

  it('says the numbers are not ready at the carrier, as a fault of the service and not of the business', async () => {
    reads.numbers.mockResolvedValue([{ ...number, readiness: 'setup_required' }, { ...number, id: 'two', readiness: 'degraded' }]);
    expect((await load()).blocker).toMatchObject({ kind: 'unavailable', code: 'numbers-not-ready', setup: 'phone-numbers' });
  });

  it('says none is assigned to this person or shared when the business has a ready number they may not use', async () => {
    expect((await load()).blocker).toEqual({ kind: 'not-configured', code: 'no-eligible-number', reason: 'No outbound number is assigned to you or shared in this business.', setup: 'phone-numbers' });
  });
});

describe('the numbers a person may call from', () => {
  it('are exactly the resolver’s candidates, in its order, never a list filtered from the inventory', async () => {
    // The inventory holds a ready number this person may not use; it is not offered.
    reads.numbers.mockResolvedValue([number, { ...number, id: 'someone-elses' }]);
    reads.options.mockResolvedValue([option('0101', 'preference', true), option('0102', 'member'), option('0103', 'organization_default'), option('0104', 'shared')]);
    const result = await load();
    expect(result.blocker).toBeNull();
    expect(result.numbers.map(line => [line.id, line.source, line.group])).toEqual([
      ['0101', 'preference', 'assigned'], ['0102', 'member', 'assigned'], ['0103', 'organization_default', 'shared'], ['0104', 'shared', 'shared'],
    ]);
    expect(result.defaultNumber).toMatchObject({ id: '0101', source: 'preference' });
  });

  it('takes Automatic from the resolver’s own mark', async () => {
    reads.options.mockResolvedValue([option('0102', 'member'), option('0104', 'shared', true)]);
    expect((await load()).defaultNumber).toMatchObject({ id: '0104', source: 'shared', group: 'shared' });
  });
});

describe('where a blocker is fixed', () => {
  const doors = [{ key: 'call-setup', label: 'Calling & routing', href: '/calling' }, { key: 'phone-numbers', label: 'Numbers & assignments', href: '/numbers' }];
  const blocker = { kind: 'not-configured', code: 'no-eligible-number', reason: 'x', setup: 'phone-numbers' } as const;
  it('is the door the blocker names, when the viewer may open it', () => {
    expect(callingSetupDoor(blocker, doors)).toEqual({ href: '/numbers', label: 'Numbers & assignments' });
  });
  it('is nothing for a viewer without that door, and nothing for a blocker the business cannot fix', () => {
    expect(callingSetupDoor(blocker, [doors[0]])).toBeNull();
    expect(callingSetupDoor({ ...blocker, setup: null }, doors)).toBeNull();
    expect(callingSetupDoor(null, doors)).toBeNull();
  });
});
