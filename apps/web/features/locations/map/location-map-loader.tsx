'use client';

import dynamic from 'next/dynamic';
import { EmptyState } from '@/components/containers/section';
import type { Location } from '@/lib/domain/locations/locations';

/**
 * The one place `maplibre-gl` is reachable from — dynamically imported with `ssr: false`, so
 * visiting `?view=list` never fetches the renderer's chunk at all. A Server Component may not
 * pass `ssr: false` to `next/dynamic` itself, which is the whole reason this thin wrapper is
 * `'use client'` and the actual workspace import lives inside it rather than in the route.
 */
const LocationMapWorkspace = dynamic(
  () => import('./location-map-workspace').then((imported) => imported.LocationMapWorkspace),
  {
    ssr: false,
    loading: () => <EmptyState className="mt-4">Loading the map…</EmptyState>,
  },
);

export function LocationMapLoader({
  organizationId,
  locations,
  mapStyleUrl,
  mayEdit,
  mayLookUp,
}: {
  organizationId: string;
  locations: Location[];
  mapStyleUrl: string | null;
  mayEdit: boolean;
  mayLookUp: boolean;
}) {
  return (
    <LocationMapWorkspace
      organizationId={organizationId}
      locations={locations}
      mapStyleUrl={mapStyleUrl}
      mayEdit={mayEdit}
      mayLookUp={mayLookUp}
    />
  );
}
