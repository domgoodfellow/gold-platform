import { CustomerPortalPage } from '@/features/portal-access/portal-page';
export const dynamic = 'force-dynamic';
export default async function PortalSubpage({ params }: PageProps<'/portal/p/[slug]'>) {
  const { slug } = await params;
  return <CustomerPortalPage path={slug}/>;
}
