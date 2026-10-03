'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/surfaces/section';
import type { Location } from '@/lib/domain/locations/locations';
import { LocationMap, type MapMarkerLocation } from '@/features/locations/map/location-map';
import { LocationMapPanel } from '@/features/locations/map/location-map-panel';

/**
 * CRM's own view onto the Location domain — a Customer's sites, read through the same
 * `customer_locations` relationship Locations itself reads, drawn with the same generic
 * `LocationMap` renderer Locations' own workspace uses. This never becomes a second map product:
 * no search, no rail, no coordinate editing — those stay on the canonical Locations workspace,
 * which `CustomerLocationsSection`'s "View all" link opens.
 */
export function CustomerLocationMap({
  organizationId,
  locations,
  mapStyleUrl,
}: {
  organizationId: string;
  locations: Location[];
  /** Null when this deployment has not configured a basemap — the pane explains itself. */
  mapStyleUrl: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mapped = useMemo(() => locations.filter((location) => location.coordinates !== null), [locations]);
  const markers: MapMarkerLocation[] = mapped.map((location) => ({
    id: location.id,
    label: location.label,
    latitude: location.coordinates!.latitude,
    longitude: location.coordinates!.longitude,
  }));
  const selected = selectedId ? (locations.find((location) => location.id === selectedId) ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="h-56 overflow-hidden rounded-md border border-border">
        {!mapStyleUrl ? (
          <EmptyState className="flex h-full items-center justify-center text-center">
            Map rendering is not configured for this deployment.
          </EmptyState>
        ) : mapped.length === 0 ? (
          <EmptyState className="flex h-full items-center justify-center text-center">
            None of this customer&rsquo;s locations have confirmed coordinates yet.
          </EmptyState>
        ) : (
          <LocationMap styleUrl={mapStyleUrl} markers={markers} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>

      {selected ? (
        <LocationMapPanel organizationId={organizationId} location={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
