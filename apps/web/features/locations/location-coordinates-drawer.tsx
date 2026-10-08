'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import type { Location } from '@/lib/domain/locations/locations';
import { LocationCoordinatesForm } from './location-coordinates-form';

/**
 * The collection's row action: a trigger, not an editor permanently expanded in every row. Opens
 * a bounded drawer hosting the one `LocationCoordinatesForm` every coordinate edit uses —
 * collection or detail, lookup or manual entry, the same form either way.
 */
export function LocationCoordinatesDrawer({
  organizationId,
  location,
  mayLookUp,
}: {
  organizationId: string;
  location: Location;
  mayLookUp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = location.coordinates
    ? `${location.coordinates.latitude}, ${location.coordinates.longitude}`
    : 'Coordinates';

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small" aria-label={`Coordinates for ${location.label}`}>
          <MapPin aria-hidden className="size-4" /> {label}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Coordinates</PageDrawerTitle>
          <PageDrawerDescription>
            Derived from the address, for weather, travel time and service areas — a place with
            none is an ordinary place.
          </PageDrawerDescription>
        </PageDrawerHeader>
        <div>
          <LocationCoordinatesForm organizationId={organizationId} location={location} mayLookUp={mayLookUp} />
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
