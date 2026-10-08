'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { MapMarkerLocation } from '@/features/locations/map/location-map';
const LocationMap = dynamic(() => import('@/features/locations/map/location-map').then(m => m.LocationMap), { ssr: false });
export function DispatchMap({ styleUrl, markers, selectedId, selectionHref }: { styleUrl: string | null; markers: MapMarkerLocation[]; selectedId: string | null; selectionHref: string }) {
  const router = useRouter();
  if (!styleUrl) return <p className="p-5 text-sm text-muted">Map services are not configured. Use List or Schedule to dispatch work.</p>;
  if (!markers.length) return <p className="p-5 text-sm text-muted">No coordinates recorded for the work in this queue. List and Schedule remain available.</p>;
  return <div className="h-[32rem] min-w-0"><LocationMap styleUrl={styleUrl} markers={markers} selectedId={selectedId} onSelect={id => router.push(`${selectionHref}&selected=${id}`, { scroll: false })}/></div>;
}
