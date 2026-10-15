import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { callerOperatingOrganization } from '@/lib/domain/platform/operating-organization';

vi.mock('@/lib/domain/platform/permissions', () => ({ platformPermissions: vi.fn() }));
vi.mock('@/lib/domain/platform/operating-organization', () => ({ callerOperatingOrganization: vi.fn() }));
const db = {} as Db;

beforeEach(() => vi.resetAllMocks());

describe('canonical Platform context resolution', () => {
  it('membership of GildOps alone supplies no Platform context', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set());
    expect(await loadPlatformContext(db)).toBeNull();
    expect(callerOperatingOrganization).not.toHaveBeenCalled();
  });
  it('an operator can resolve Platform while working in any business', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.providers']));
    vi.mocked(callerOperatingOrganization).mockResolvedValue({ id: 'gold' });
    const context = await loadPlatformContext(db);
    expect(callerOperatingOrganization).toHaveBeenCalledWith(db);
    expect(context?.href).toBe('/organizations/gold/platform');
    expect(context?.organizationId).toBe('gold');
    const root = context?.sections[0].items[0];
    expect(root?.children?.[0].children?.map((item) => item.key)).toEqual(['platform-providers', 'platform-ai-runtime']);
  });
  it('supplies no context without a configured operating organization the caller belongs to', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.health']));
    vi.mocked(callerOperatingOrganization).mockResolvedValue(null);
    expect(await loadPlatformContext(db)).toBeNull();
  });
  it('does not interpret an unreadable permission row as a grant or silent denial', async () => {
    vi.mocked(platformPermissions).mockRejectedValue(new Error('Permission read failed'));
    await expect(loadPlatformContext(db)).rejects.toThrow('Permission read failed');
  });
  it('does not interpret an unreadable operating identity as "not GildOps"', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.health']));
    vi.mocked(callerOperatingOrganization).mockRejectedValue(new Error('Identity read failed'));
    await expect(loadPlatformContext(db)).rejects.toThrow('Identity read failed');
  });
});
