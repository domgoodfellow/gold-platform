// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientTenantSection } from '@/features/crm/customers/client-tenant-section';
import type { ClientTenantRelationship } from '@/lib/domain/customers/client-tenants';

vi.mock('@/app/organizations/[organizationId]/crm/contacts/[contactId]/service-actions', () => ({ relationshipAction: vi.fn() }));
afterEach(cleanup);
const relationship: ClientTenantRelationship = { id: 'relationship', customer_id: 'customer', tenant_organization_id: 'tenant', status: 'active', origin: 'proposal_handoff', created_at: '2026-10-13T10:00:00Z', ended_at: null, tenant_name: 'Acme Plumbing', operational_state: 'setup', may_open: false };
const props = { organizationId: 'seller', customerId: 'customer', tenants: [{ id: 'tenant', name: 'Acme Plumbing' }], mayManage: false, mayLink: false };

describe('Customer relationship disclosure', () => {
  it('shows a truthful empty state without unauthorized controls', () => {
    render(<ClientTenantSection {...props} relationships={[]}/>);
    expect(screen.getByText('No GildOps organization linked.')).toBeVisible();
    expect(screen.queryByText('Link existing organization')).not.toBeInTheDocument();
  });
  it('keeps tenant navigation absent when the operator lacks target membership', () => {
    render(<ClientTenantSection {...props} mayManage relationships={[relationship]}/>);
    expect(screen.getByText('Acme Plumbing')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open organization' })).not.toBeInTheDocument();
    expect(screen.getByText('Manage relationship')).toBeVisible();
    expect(screen.queryByText('Link existing organization')).not.toBeInTheDocument();
  });
  it('navigates only with membership and gives verified operators labeled real selectors', () => {
    render(<ClientTenantSection {...props} mayManage mayLink relationships={[{ ...relationship, may_open: true }]}/>);
    expect(screen.getByRole('link', { name: 'Open organization' })).toHaveAttribute('href', '/organizations/tenant');
    expect(screen.getByLabelText('Organization')).toHaveAttribute('name', 'tenantId');
    expect(screen.getByLabelText('Verified association basis')).toHaveAttribute('minlength', '10');
  });
  it('retains ended history without an ending control', () => {
    render(<ClientTenantSection {...props} mayManage relationships={[{ ...relationship, status: 'ended', ended_at: '2026-10-14T10:00:00Z' }]}/>);
    expect(screen.getByText('Relationship ended')).toBeVisible();
    expect(screen.queryByText('Manage relationship')).not.toBeInTheDocument();
  });
});
