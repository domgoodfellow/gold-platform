'use client';

import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { RecordReadingForm } from './record-reading-form';

/**
 * The collection's row action: a trigger, not a reading form permanently expanded in every row.
 * Opens a bounded drawer hosting the one `RecordReadingForm` both list and detail use — there,
 * the asset is already the one thing on screen, so its own Readings section renders the form
 * directly instead.
 */
export function RecordReadingDrawer({
  organizationId,
  assetId,
  assetName,
  lastUnit,
  action,
}: {
  organizationId: string;
  assetId: string;
  assetName: string;
  lastUnit: string;
  action: (
    previous: { error: string | null },
    formData: FormData,
  ) => Promise<{ error: string | null }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small" aria-label={`Record reading for ${assetName}`}>
          <Gauge aria-hidden className="size-4" /> Record reading
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Record reading</PageDrawerTitle>
          <PageDrawerDescription>What {assetName}&rsquo;s counter says today.</PageDrawerDescription>
        </PageDrawerHeader>
        <div className="px-4 pb-4">
          <RecordReadingForm
            organizationId={organizationId}
            assetId={assetId}
            assetName={assetName}
            lastUnit={lastUnit}
            action={action}
          />
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
