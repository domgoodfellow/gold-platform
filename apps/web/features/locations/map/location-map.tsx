'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MaplibreMap, Marker, NavigationControl } from 'maplibre-gl';
import { createLocationMarkerElement, setLocationMarkerSelected } from './location-map-marker';

export type MapMarkerLocation = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

const SINGLE_MARKER_ZOOM = 13;
const MIN_SELECTED_ZOOM = 12;

/**
 * The renderer, and nothing else — mount/unmount, markers, bounds. What a marker *means* and
 * what happens when one is picked lives in `LocationMapWorkspace`; this only draws the canvas
 * MapLibre asks for and reports a click back by id.
 *
 * **Bounds are fit on mount and whenever the marker id set changes, never on every render** — a
 * `useEffect` that fit-bounded on every prop change would fight a person who had just panned
 * away to look at something. Selecting a location pans toward it in its own effect, keyed only
 * on the selected id, for the same reason.
 */
export function LocationMap({
  styleUrl,
  markers,
  selectedId,
  onSelect,
}: {
  styleUrl: string;
  markers: MapMarkerLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerElements = useRef(new Map<string, { marker: Marker; element: HTMLElement }>());
  const onSelectRef = useRef(onSelect);
  const lastFitIds = useRef<string>('');

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Mount once. `styleUrl` is read from server configuration and does not change across the
  // life of this component, so it is not a dependency — swapping the basemap mid-session is not
  // a case this needs to handle.
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: styleUrl,
      center: [0, 0],
      zoom: 1,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    const ownMarkers = markerElements.current;

    return () => {
      for (const { marker } of ownMarkers.values()) marker.remove();
      ownMarkers.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design; see comment above.
  }, []);

  // Add/remove markers as the dataset changes; fit bounds only when the id set itself changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const next = new Map(markers.map((location) => [location.id, location]));
    const existing = markerElements.current;

    for (const [id, entry] of existing) {
      if (!next.has(id)) {
        entry.marker.remove();
        existing.delete(id);
      }
    }

    for (const location of markers) {
      if (existing.has(location.id)) continue;
      const element = createLocationMarkerElement({
        label: location.label,
        selected: location.id === selectedId,
        onSelect: () => onSelectRef.current(location.id),
      });
      const marker = new Marker({ element })
        .setLngLat([location.longitude, location.latitude])
        .addTo(map);
      existing.set(location.id, { marker, element });
    }

    const ids = [...next.keys()].sort().join(',');
    if (ids === lastFitIds.current) return;
    lastFitIds.current = ids;

    if (markers.length === 0) return;

    const run = () => {
      if (markers.length === 1) {
        map.flyTo({ center: [markers[0].longitude, markers[0].latitude], zoom: SINGLE_MARKER_ZOOM });
        return;
      }
      const bounds = markers.reduce(
        (acc, location) => acc.extend([location.longitude, location.latitude]),
        new LngLatBounds(
          [markers[0].longitude, markers[0].latitude],
          [markers[0].longitude, markers[0].latitude],
        ),
      );
      map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
    };

    if (map.loaded()) run();
    else map.once('load', run);
  }, [markers, selectedId]);

  // Selection: restyle every marker, and pan toward the selected one without resetting zoom to
  // something street-level-tight or fighting whatever the person was already looking at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const [id, { element }] of markerElements.current) {
      setLocationMarkerSelected(element, id === selectedId);
    }

    if (!selectedId) return;
    const selected = markers.find((location) => location.id === selectedId);
    if (!selected) return;

    const zoom = Math.max(map.getZoom(), MIN_SELECTED_ZOOM);
    map.easeTo({ center: [selected.longitude, selected.latitude], zoom });
  }, [selectedId, markers]);

  return <div ref={containerRef} className="size-full" role="application" aria-label="Map of location markers" />;
}
