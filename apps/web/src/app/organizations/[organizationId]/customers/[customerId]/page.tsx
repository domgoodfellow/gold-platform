import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomFieldValues } from '@/components/custom-field-values';
import { getCustomer } from '@/lib/domain/customers/customers';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { requireOrganization } from '@/lib/route/organization';
import { UploadDocumentForm } from './upload-document-form';

export const dynamic = 'force-dynamic';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function CustomerPage({
  params,
}: PageProps<'/organizations/[organizationId]/customers/[customerId]'>) {
  const { organizationId, customerId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's customer id resolves to null, so this renders a 404 rather than an
  // empty page. From this caller's position the customer genuinely does not exist.
  const customer = await getCustomer(db, { organizationId, customerId });
  if (!customer) {
    notFound();
  }

  const [documents, definitions] = await Promise.all([
    listDocuments(db, {
      organizationId,
      attachedTo: { entity: 'customer', id: customerId },
    }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
  ]);

  const mayAttach = organization.capabilities.includes('document.create');

  return (
    <>
      <Link
        href={`/organizations/${organizationId}/customers`}
        className="text-sm underline underline-offset-4 opacity-70"
      >
        ← Customers
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{customer.name}</h1>
      {customer.email || customer.phone ? (
        <p className="text-sm opacity-70">
          {[customer.email, customer.phone].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <CustomFieldValues definitions={definitions} custom={customer.custom} />

      <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Documents</h2>

        {documents.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">Nothing attached yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {documents.map((document) => (
              <li key={document.id} className="flex items-baseline justify-between py-3">
                <div>
                  {/*
                    Points at our own route, never at storage. The signed URL is minted when
                    this is clicked and lives sixty seconds; a link to storage rendered into
                    this page would be the durable URL constraints.md forbids.
                  */}
                  <a
                    href={`/organizations/${organizationId}/documents/${document.id}/download`}
                    className="font-medium underline underline-offset-4"
                  >
                    {document.fileName}
                  </a>
                  <div className="text-sm opacity-70">
                    {[document.mimeType, formatSize(document.sizeBytes)].join(' · ')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {mayAttach ? (
          <UploadDocumentForm organizationId={organizationId} customerId={customerId} />
        ) : (
          <p className="mt-4 text-sm opacity-70">
            Your role, {organization.role}, cannot attach documents here.
          </p>
        )}
      </section>
    </>
  );
}
