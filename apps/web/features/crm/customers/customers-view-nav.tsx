import { ViewNav } from '@/components/containers/view-nav';

/**
 * Customers' two sibling views. Both pages render this, so List and Pipeline are symmetric: each
 * is a route, neither is remembered client state, and the nav appears only where the Pipeline
 * exists at all (the business has Communications/Voice on).
 */
export function CustomersViewNav({
  organizationId,
  current,
}: {
  organizationId: string;
  current: 'list' | 'pipeline';
}) {
  const root = `/organizations/${organizationId}/customers`;
  return (
    <ViewNav
      label="Customers views"
      current={current}
      views={[
        { key: 'list', label: 'List', href: root },
        { key: 'pipeline', label: 'Pipeline', href: `${root}/pipeline` },
      ]}
    />
  );
}
