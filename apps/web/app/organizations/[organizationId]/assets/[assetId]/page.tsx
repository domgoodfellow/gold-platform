import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { DefinitionList, Detail } from '@/components/display/data';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import { ActivityList } from '@/features/timeline/activity-list';
import { getAsset } from '@/lib/domain/assets/assets';
import { listAssetReadings } from '@/lib/domain/assets/readings';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listAssetTimeline } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { recordReadingAction, uploadAssetDocumentAction } from './actions';
import { RecordReadingForm } from '../create-asset-form';

export const dynamic = 'force-dynamic';

export default async function AssetPage({
  params,
}: PageProps<'/organizations/[organizationId]/assets/[assetId]'>) {
  const { organizationId, assetId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's asset id resolves to null, so this renders a 404 rather than an empty
  // page — the same indistinguishability `getCustomer` relies on RLS for.
  const asset = await getAsset(db, { organizationId, assetId });
  if (!asset) {
    notFound();
  }

  const [readings, definitions, documents, workItems, timeline] = await Promise.all([
    listAssetReadings(db, { organizationId, assetId }),
    listFieldDefinitions(db, { organizationId, entityType: 'asset' }),
    listDocuments(db, { organizationId, attachedTo: { entity: 'asset', id: assetId } }),
    listWorkItems(db, { organizationId, assetId }),
    listAssetTimeline(db, { organizationId, assetId }),
  ]);

  const mayRecord = organization.capabilities.includes('asset.create');
  const mayAttach = organization.capabilities.includes('document.create');

  return (
    <>
      <RecordHeader
        title={asset.name}
        crumbs={[
          { label: 'Assets', href: `/organizations/${organizationId}/assets` },
          { label: asset.name },
        ]}
      />

      <DefinitionList className="mt-3">
        <Detail label="Owned by">
          {asset.customer ? (
            <Link
              href={`/organizations/${organizationId}/customers/${asset.customer.id}`}
              className="underline underline-offset-4"
            >
              {asset.customer.label}
            </Link>
          ) : null}
        </Detail>
        <Detail label="Location">
          {asset.location ? (
            <Link
              href={`/organizations/${organizationId}/locations/${asset.location.id}`}
              className="underline underline-offset-4"
            >
              {asset.location.label}
            </Link>
          ) : null}
        </Detail>
      </DefinitionList>

      <CustomFieldValues definitions={definitions} custom={asset.custom} />

      <Section className="mt-10">
        <SectionHeading>Readings</SectionHeading>

        {readings.length === 0 ? (
          <EmptyState className="mt-2">No readings recorded yet.</EmptyState>
        ) : (
          <DividedList className="mt-2">
            {readings.map((reading) => (
              <li key={reading.id} className="flex items-baseline justify-between py-2 text-sm">
                <span className="tabular-nums">
                  {reading.value} {reading.unit}
                </span>
                <span className="text-muted">
                  {new Date(reading.readAt).toLocaleString('en-GB')}
                </span>
              </li>
            ))}
          </DividedList>
        )}

        {/* Hiding it is a courtesy, not the guard: `asset_readings_insert` requires
            asset.create in the database (I12). */}
        {mayRecord ? (
          <RecordReadingForm
            organizationId={organizationId}
            assetId={assetId}
            assetName={asset.name}
            lastUnit={readings[0]?.unit ?? ''}
            action={recordReadingAction}
          />
        ) : (
          <Hint className="mt-2">
            Your role, {organization.role}, cannot record readings here.
          </Hint>
        )}
      </Section>

      <Section className="mt-10">
        <SectionHeading>Work</SectionHeading>

        {workItems.length === 0 ? (
          <EmptyState className="mt-2">No work recorded against this asset.</EmptyState>
        ) : (
          <DividedList className="mt-2">
            {workItems.map((item) => (
              <li key={item.id} className="py-2">
                <Link
                  href={`/organizations/${organizationId}/work/${item.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {item.title}
                </Link>
                <div className="text-sm text-muted">{item.status.label}</div>
              </li>
            ))}
          </DividedList>
        )}
      </Section>

      <DocumentsSection
        organizationId={organizationId}
        documents={documents}
        mayAttach={mayAttach}
        roleLabel={organization.role}
        uploadAction={uploadAssetDocumentAction}
        hiddenFields={{ organizationId, assetId }}
      />

      <Section className="mt-10">
        <SectionHeading>History</SectionHeading>
        {/* Not capability-gated, the same reasoning Customer and Work Item's own History
            sections give: `events` is already restricted by RLS to this tenant, so there is
            nothing here a member of this business may not see. Separate from Readings above,
            deliberately — a reading is the counter log, this is what happened around the asset. */}
        <ActivityList timeline={timeline} timezone={organization.timezone} />
      </Section>
    </>
  );
}
