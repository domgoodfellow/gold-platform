import Link from 'next/link';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import type { AssetReading } from '@/lib/domain/assets/readings';
import type { Asset } from '@/lib/domain/assets/assets';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { RecordReadingDrawer } from './record-reading-drawer';

/**
 * The Assets collection. **Recording a reading is the action a list of assets implies**, which
 * is why it is the row action — a bounded drawer, not a reading form permanently expanded in
 * every row. `latestReadings` is a ready lookup the route already resolved in one query
 * (`listLatestAssetReadings`), never a per-row read here.
 */
export function AssetTable({
  organizationId,
  assets,
  latestReadings,
  definitions,
  mayRecord,
  recordReadingAction,
}: {
  organizationId: string;
  assets: Asset[];
  latestReadings: Map<string, AssetReading>;
  definitions: FieldDefinition[];
  mayRecord: boolean;
  recordReadingAction: (
    previous: { error: string | null },
    formData: FormData,
  ) => Promise<{ error: string | null }>;
}) {
  return (
    <DataTable
      rows={assets}
      rowKey={(asset) => asset.id}
      empty="No assets yet."
      actions={
        mayRecord
          ? (asset) => (
              <RecordReadingDrawer
                organizationId={organizationId}
                assetId={asset.id}
                assetName={asset.name}
                lastUnit={latestReadings.get(asset.id)?.unit ?? ''}
                action={recordReadingAction}
              />
            )
          : undefined
      }
      columns={[
        {
          key: 'name',
          header: 'Asset',
          emphasis: 'primary',
          cell: (asset) => (
            <Link href={`/organizations/${organizationId}/assets/${asset.id}`} className="underline underline-offset-4">
              {asset.name}
            </Link>
          ),
        },
        {
          key: 'where',
          header: 'Whose, and where',
          cell: (asset) =>
            [asset.customer ? `Owned by ${asset.customer.label}` : null, asset.location ? `at ${asset.location.label}` : null]
              .filter(Boolean)
              .join(' · ') || null,
        },
        {
          key: 'reading',
          header: 'Last read',
          cell: (asset) => {
            const reading = latestReadings.get(asset.id);
            if (!reading) return <span className="text-subtle">—</span>;
            return (
              <span className="tabular-nums">
                {reading.value} {reading.unit}
                <span className="text-muted"> · {new Date(reading.readAt).toLocaleDateString('en-GB')}</span>
              </span>
            );
          },
        },
        ...(definitions.length > 0
          ? [
              {
                key: 'custom',
                header: 'Custom fields',
                emphasis: 'secondary' as const,
                cell: (asset: Asset) => <CustomFieldValues definitions={definitions} custom={asset.custom} />,
              },
            ]
          : []),
      ]}
    />
  );
}
