import Link from 'next/link';
import { PageHeader } from '@/components/headers/page-header';
import { AppPage } from '@/components/layout/app-page';
import { HelpBrowser } from '@/features/help/help-browser';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Help & Documentation: how to use GildOps. Not the Support workspace, which is a business serving its own customers. */
export default async function HelpPage({ params }: PageProps<'/organizations/[organizationId]/help'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <AppPage width="reading">
      <PageHeader
        section="Help"
        title="Help & documentation"
        meta={
          <>
            Guides to using GildOps. Need a person?{' '}
            <Link href={`/organizations/${organizationId}/help/contact`} className="text-accent-text hover:underline">Contact GildOps Support</Link>.
          </>
        }
      />
      <HelpBrowser organizationId={organizationId} />
    </AppPage>
  );
}
