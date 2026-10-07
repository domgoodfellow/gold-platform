import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';

vi.mock('@/lib/domain/platform/permissions', () => ({ platformPermissions: vi.fn() }));
vi.mock('@/lib/domain/tenancy/gold-internal', () => ({ findGoldInternalOrganization: vi.fn() }));
const db = {} as Db;
const memberships = [{ id: 'tenant' }, { id: 'gold' }];

beforeEach(() => vi.resetAllMocks());

describe('canonical Platform context resolution', () => {
  it('membership of GildOps alone supplies no Platform context', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set());
    expect(await loadPlatformContext(db, memberships)).toBeNull();
    expect(findGoldInternalOrganization).not.toHaveBeenCalled();
  });
  it('an operator can resolve Platform while working in any business', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.providers']));
    vi.mocked(findGoldInternalOrganization).mockResolvedValue({ id: 'gold' });
    const context = await loadPlatformContext(db, memberships);
    expect(findGoldInternalOrganization).toHaveBeenCalledWith(db, memberships);
    expect(context?.href).toBe('/organizations/gold/platform');
    expect(context?.organizationId).toBe('gold');
    const root = context?.sections[0].items[0];
    expect(root?.children?.[0].children?.map((item) => item.key)).toEqual(['platform-providers', 'platform-ai-runtime']);
  });
  it('retains canonical membership and GildOps organization resolution for the URL container', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.health']));
    vi.mocked(findGoldInternalOrganization).mockResolvedValue(null);
    expect(await loadPlatformContext(db, memberships)).toBeNull();
  });
  it('does not interpret an unreadable permission row as a grant or silent denial', async () => {
    vi.mocked(platformPermissions).mockRejectedValue(new Error('Permission read failed'));
    await expect(loadPlatformContext(db, memberships)).rejects.toThrow('Permission read failed');
  });
});
