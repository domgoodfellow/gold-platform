import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { isOperatingOrganization } from '@/lib/domain/platform/operating-organization';

vi.mock('@/lib/domain/platform/permissions', () => ({ platformPermissions: vi.fn() }));
vi.mock('@/lib/domain/platform/operating-organization', () => ({ isOperatingOrganization: vi.fn() }));
const db = {} as Db;

beforeEach(() => vi.resetAllMocks());

describe('platform context for one organization shell', () => {
  it('membership of GildOps alone supplies no platform context', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set());
    expect(await loadPlatformContext(db, 'gold')).toBeNull();
    expect(isOperatingOrganization).not.toHaveBeenCalled();
  });
  it('supplies the live permissions inside the operating organization', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.providers']));
    vi.mocked(isOperatingOrganization).mockResolvedValue(true);
    const context = await loadPlatformContext(db, 'gold');
    expect(isOperatingOrganization).toHaveBeenCalledWith(db, { organizationId: 'gold' });
    expect(context?.organizationId).toBe('gold');
    expect([...context!.permissions]).toEqual(['platform.providers']);
  });
  it('supplies nothing to a staff member working inside any other organization', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.health']));
    vi.mocked(isOperatingOrganization).mockResolvedValue(false);
    expect(await loadPlatformContext(db, 'customer')).toBeNull();
  });
  it('does not interpret an unreadable permission row as a grant or silent denial', async () => {
    vi.mocked(platformPermissions).mockRejectedValue(new Error('Permission read failed'));
    await expect(loadPlatformContext(db, 'gold')).rejects.toThrow('Permission read failed');
  });
  it('does not interpret an unreadable operating identity as "not GildOps"', async () => {
    vi.mocked(platformPermissions).mockResolvedValue(new Set(['platform.health']));
    vi.mocked(isOperatingOrganization).mockRejectedValue(new Error('Identity read failed'));
    await expect(loadPlatformContext(db, 'gold')).rejects.toThrow('Identity read failed');
  });
});
