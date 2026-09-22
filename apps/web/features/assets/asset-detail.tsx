import Link from 'next/link';
import { DefinitionList, Detail } from '@/components/display/data';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { ActivityList } from '@/features/timeline/activity-list';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';
import type { Asset } from '@/lib/domain/assets/assets';
import type { AssetReading } from '@/lib/domain/assets/readings';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { StoredDocument } from '@/lib/domain/documents/documents';
import { RecordReadingForm } from './record-reading-form';

/**
 * One asset's record: what the route loaded, composed into Overview, Work, Documents and
 * Activity. The route still owns `RecordHeader` and every Server Action; this owns only how the
 * loaded data reads. Readings render directly in the Overview section here — unlike the
 * collection's bounded drawer, the asset is already the one thing on screen.
 */
export function AssetDetail({
  organizationId,
  asset,
  readings,
  definitions,
  workItems,
  documents,
  timeline,
  mayRecord,
  mayAttach,
  role,
  timezone,
  recordReadingAction,
  uploadAction,
}: {
  organizationId: string;
  asset: Asset;
  readings: AssetReading[];
  definitions: FieldDefinition[];
  workItems: { id: string; title: string; status: { label: string } }[];
  documents: StoredDocument[];
  timeline: TimelineEntry[];
  mayRecord: boolean;
  mayAttach: boolean;
  role: string;
  timezone: string;
  recordReadingAction: (
    previous: { error: string | null },
    formData: FormData,
  ) => Promise<{ error: string | null }>;
  uploadAction: (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="work">Work</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        <DefinitionList>
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

        <Section className="mt-8">
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
                  <span className="text-muted">{new Date(reading.readAt).toLocaleString('en-GB')}</span>
                </li>
              ))}
            </DividedList>
          )}

          {/* Hiding it is a courtesy, not the guard: `asset_readings_insert` requires
              asset.create in the database (I12). */}
          {mayRecord ? (
            <RecordReadingForm
              organizationId={organizationId}
              assetId={asset.id}
              assetName={asset.name}
              lastUnit={readings[0]?.unit ?? ''}
              action={recordReadingAction}
            />
          ) : (
            <Hint className="mt-2">Your role, {role}, cannot record readings here.</Hint>
          )}
        </Section>
      </TabsContent>

      <TabsContent value="work" className="mt-6">
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
      </TabsContent>

      <TabsContent value="documents" className="mt-6">
        <DocumentsSection
          organizationId={organizationId}
          documents={documents}
          mayAttach={mayAttach}
          roleLabel={role}
          uploadAction={uploadAction}
          hiddenFields={{ organizationId, assetId: asset.id }}
          className="mt-0"
        />
      </TabsContent>

      <TabsContent value="activity" className="mt-6">
        {/* Not capability-gated, the same reasoning Customer and Work Item's own History
            sections give: `events` is already restricted by RLS to this tenant, so there is
            nothing here a member of this business may not see. Separate from Readings above,
            deliberately — a reading is the counter log, this is what happened around the asset. */}
        <ActivityList timeline={timeline} timezone={timezone} />
      </TabsContent>
    </Tabs>
  );
}
