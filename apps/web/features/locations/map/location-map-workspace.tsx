'use client';

import { useMemo, useState } from 'react';
import { MapPinOff } from 'lucide-react';
import { EmptyState } from '@/components/surfaces/section';
import { TextInput } from '@/components/controls/inputs';
import type { Location } from '@/lib/domain/locations/locations';
import { LocationCoordinatesDrawer } from '../location-coordinates-drawer';
import { LocationMap, type MapMarkerLocation } from './location-map';
import { LocationMapPanel } from './location-map-panel';
import { filterLocationsByQuery } from './location-search';

function RailRow({
  organizationId,
  location,
  selected,
  mayEdit,
  mayLookUp,
  onSelect,
}: {
  organizationId: string;
  location: Location;
  selected: boolean;
  mayEdit: boolean;
  mayLookUp: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm ${
        selected ? 'border-accent bg-hover' : 'border-transparent hover:bg-hover'
      }`}
    >
      <button type="button" onClick={onSelect} className="flex flex-col gap-1 text-left">
        <span className="font-medium">{location.label}</span>
        <span className="text-muted">{location.address}</span>
        <span className="text-subtle">
          {location.customers.length > 0
            ? `${location.customers.length} customer${location.customers.length === 1 ? '' : 's'}`
            : 'No customers served'}
        </span>
      </button>

      {location.coordinates ? (
        <span className="text-xs text-subtle">Mapped</span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-subtle">
            <MapPinOff aria-hidden className="size-3" /> Location not mapped
          </span>
          {mayEdit ? (
            <LocationCoordinatesDrawer organizationId={organizationId} location={location} mayLookUp={mayLookUp} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * List and Map are the same collection, differently represented — one `Location[]` from the
 * route feeds both. The rail is not decoration beside the canvas: it is the accessible, always-
 * complete reading of the dataset a map alone cannot give (the advisory-availability rule, extended to geography) — every
 * location is in it, mapped or not, and it is how coordinate editing and the record route stay
 * reachable without touching the map canvas at all.
 */
export function LocationMapWorkspace({
  organizationId,
  locations,
  mapStyleUrl,
  mayEdit,
  mayLookUp,
}: {
  organizationId: string;
  locations: Location[];
  /** Null when this deployment has not configured a basemap — the Map pane explains itself. */
  mapStyleUrl: string | null;
  mayEdit: boolean;
  mayLookUp: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => filterLocationsByQuery(locations, query), [locations, query]);
  const mapped = useMemo(() => filtered.filter((location) => location.coordinates !== null), [filtered]);
  const hasAnyMapped = useMemo(() => locations.some((location) => location.coordinates !== null), [locations]);

  const markers: MapMarkerLocation[] = mapped.map((location) => ({
    id: location.id,
    label: location.label,
    latitude: location.coordinates!.latitude,
    longitude: location.coordinates!.longitude,
  }));

  const selected = selectedId ? (locations.find((location) => location.id === selectedId) ?? null) : null;

  return (
    <div className="mt-4 flex flex-col gap-4 lg:h-[70vh] lg:flex-row">
      <div className="flex flex-col gap-3 lg:h-full lg:w-80 lg:shrink-0">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search locations…"
          aria-label="Search locations"
        />

        {selected ? (
          <LocationMapPanel organizationId={organizationId} location={selected} onClose={() => setSelectedId(null)} />
        ) : null}

        <div className="flex flex-col gap-1 overflow-y-auto lg:flex-1">
          {locations.length === 0 ? (
            <EmptyState>No locations yet.</EmptyState>
          ) : filtered.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted">No location matches “{query}”.</p>
          ) : (
            filtered.map((location) => (
              <RailRow
                key={location.id}
                organizationId={organizationId}
                location={location}
                selected={location.id === selectedId}
                mayEdit={mayEdit}
                mayLookUp={mayLookUp}
                onSelect={() => setSelectedId(location.id === selectedId ? null : location.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="h-72 overflow-hidden rounded-md border border-border lg:h-full lg:flex-1">
        {!mapStyleUrl ? (
          <EmptyState className="flex h-full items-center justify-center text-center">
            Maps aren’t available yet.
          </EmptyState>
        ) : !hasAnyMapped ? (
          <EmptyState className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <span>No locations have confirmed coordinates yet.</span>
            <span className="text-sm text-muted">Add coordinates from the list to plot them here.</span>
          </EmptyState>
        ) : (
          <LocationMap styleUrl={mapStyleUrl} markers={markers} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>
    </div>
  );
}
