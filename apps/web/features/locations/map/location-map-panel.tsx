import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import type { Location } from '@/lib/domain/locations/locations';

/**
 * What selecting a marker or a rail row reveals — compact, not the record. The full detail stays
 * on the record route (`ui-spec.md`'s reasoning for keeping a page's own controls off a shared
 * surface, applied to a map popup rather than a header).
 */
export function LocationMapPanel({
  organizationId,
  location,
  onClose,
}: {
  organizationId: string;
  location: Location;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{location.label}</div>
        <Button type="button" tone="secondary" size="tiny" aria-label="Close" onClick={onClose}>
          <X aria-hidden className="size-3.5" />
        </Button>
      </div>
      <div className="text-sm text-muted">{location.address}</div>
      {location.accessNotes ? <div className="text-sm text-subtle">{location.accessNotes}</div> : null}
      <div className="text-sm">
        {location.customers.length > 0
          ? `Serves ${location.customers.map((customer) => customer.name).join(', ')}`
          : 'No customers served from here yet.'}
      </div>
      <Link
        href={`/organizations/${organizationId}/locations/${location.id}`}
        className="flex items-center gap-1 text-sm underline underline-offset-4"
      >
        View location <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}
