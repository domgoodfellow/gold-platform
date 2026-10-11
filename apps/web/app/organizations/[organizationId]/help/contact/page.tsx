import { PageHeader } from '@/components/headers/page-header';
import { AppPage } from '@/components/layout/app-page';
import { Hint } from '@/components/controls/inputs';
import { ContactSupportForm } from '@/features/help/contact-support-form';
import { safeAppReturnPath } from '@/lib/route/app-return';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Contact GildOps Support: a request from this business's operator to the platform provider. It is
 * not a Support case, which belongs to the business's own customers, and sending one gives GildOps
 * staff no access to this business.
 */
export default async function ContactSupportPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/help/contact'>) {
  const { organizationId } = await params;
  const { from } = await searchParams;
  const { organization } = await requireOrganization(organizationId);
  const page = safeAppReturnPath(typeof from === 'string' ? from : null, organizationId);

  return (
    <AppPage width="reading">
      <PageHeader
        section="Help"
        title="Contact GildOps Support"
      />
      <Hint className="mb-6">
        This reaches GildOps about the product, for {organization.name}. We record who is asking, which business, and the page you came from. Nothing else from your business is attached, and sending a request does not give GildOps access to it.
      </Hint>
      <ContactSupportForm organizationId={organizationId} page={page} />
    </AppPage>
  );
}
