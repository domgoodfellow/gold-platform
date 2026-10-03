'use client';

import dynamic from 'next/dynamic';
import { EmptyState } from '@/components/surfaces/section';
import type { Location } from '@/lib/domain/locations/locations';

/**
 * The one place `maplibre-gl` is reachable from on the Customer record — dynamically imported
 * with `ssr: false`, the same reason `location-map-loader.tsx` is a thin wrapper rather than
 * importing the renderer directly from a Server Component.
 */
const CustomerLocationMap = dynamic(
  () => import('./customer-location-map').then((imported) => imported.CustomerLocationMap),
  {
    ssr: false,
    loading: () => <EmptyState className="flex h-56 items-center justify-center text-center">Loading the map…</EmptyState>,
  },
);

export function CustomerLocationMapLoader({
  organizationId,
  locations,
  mapStyleUrl,
}: {
  organizationId: string;
  locations: Location[];
  mapStyleUrl: string | null;
}) {
  return <CustomerLocationMap organizationId={organizationId} locations={locations} mapStyleUrl={mapStyleUrl} />;
}
