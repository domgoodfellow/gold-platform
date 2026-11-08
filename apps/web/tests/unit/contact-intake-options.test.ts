import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';

const sources = vi.hoisted(() => ({ listResources: vi.fn(), listConnections: vi.fn() }));
vi.mock('@/lib/domain/integrations/resources', () => ({ listResources: sources.listResources }));
vi.mock('@/lib/domain/integrations/connections', () => ({ listConnections: sources.listConnections }));
const { anyIntake, contactIntakeOptions } = await import('@/lib/application/crm/contact-intake');

const db = {} as Db;
const options = (capabilities: string[], modules: string[] = []) => contactIntakeOptions(db, { organizationId: 'org', capabilities, modules: new Set(modules) });
beforeEach(() => {
  sources.listResources.mockReset().mockResolvedValue([
    { id: 'sheet', connectionId: 'conn', resourceType: 'google_sheet', displayName: 'Leads sheet', status: 'active' },
    { id: 'csv', connectionId: null, resourceType: 'file_upload', displayName: 'leads.csv', status: 'active' },
    { id: 'old', connectionId: 'conn', resourceType: 'microsoft_workbook', displayName: 'Retired', status: 'disabled' },
  ]);
  sources.listConnections.mockReset().mockResolvedValue([{ id: 'conn', status: 'needs_attention' }]);
});

describe('contact intake permission contract', () => {
  it('offers every path to a member who holds each destination capability', async () => {
    const result = await options(['customer.create', 'customer.update', 'integration.manage'], ['integrations']);
    expect(result.manual).toEqual({ state: 'available' });
    expect(result.import).toEqual({ state: 'available', href: '/organizations/org/library/imports/new', note: undefined });
    expect(result.sync).toMatchObject({ state: 'available', connectHref: '/organizations/org/settings/connections',
      sources: [{ id: 'sheet', name: 'Leads sheet', type: 'Google Sheets worksheet', connection: 'needs_attention', href: '/organizations/org/library/sources/sheet' }] });
  });
  it('does not require the Integrations module for file import; it only gates connecting a provider', async () => {
    const result = await options(['customer.create', 'customer.update', 'integration.manage']);
    expect(result.import.state).toBe('available');
    expect(result.sync).toMatchObject({ state: 'available', connectHref: undefined });
    sources.listResources.mockResolvedValue([]);
    expect((await options(['customer.create', 'customer.update', 'integration.manage'])).sync).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('Integrations in your plan') });
  });
  it('explains each refused path separately and never reads sources without integration.manage', async () => {
    const result = await options(['customer.update']);
    expect(result.manual).toEqual({ state: 'unavailable', reason: 'Your role cannot add contacts.' });
    expect(result.import).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('manage data sources') });
    expect(result.sync).toMatchObject({ state: 'unavailable' });
    expect(sources.listResources).not.toHaveBeenCalled();
    expect(anyIntake(result)).toBe(false);
  });
  it('matches the per-row write checks: import needs customer.create or customer.update and says which half is missing', async () => {
    expect((await options(['integration.manage'])).import).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('cannot add or change') });
    expect((await options(['integration.manage', 'customer.update'])).import).toMatchObject({ state: 'available', note: expect.stringContaining('cannot add new ones') });
    expect((await options(['integration.manage', 'customer.create'])).import).toMatchObject({ state: 'available', note: expect.stringContaining('cannot update existing ones') });
  });
});
