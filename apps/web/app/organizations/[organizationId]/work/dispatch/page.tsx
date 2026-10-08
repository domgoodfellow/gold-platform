import { requireOrganization } from '@/lib/route/organization';
import { DispatchWorkspace } from '@/features/work/dispatch-workspace';
export const dynamic = 'force-dynamic';
export default async function DispatchPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work/dispatch'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const context = await requireOrganization(organizationId);
  return <DispatchWorkspace organizationId={organizationId} query={query} {...context}/>;
}
