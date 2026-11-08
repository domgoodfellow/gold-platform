'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { MapMarkerLocation } from '@/features/locations/map/location-map';
const LocationMap = dynamic(() => import('@/features/locations/map/location-map').then(m => m.LocationMap), { ssr: false });
export function DispatchMap({ styleUrl, markers, selectedId, selectionHref }: { styleUrl: string | null; markers: MapMarkerLocation[]; selectedId: string | null; selectionHref: string }) {
  const router = useRouter();
  if (!styleUrl) return <p className="p-5 text-sm text-muted">The map isn&apos;t available yet. Use the queue or open Schedule.</p>;
  if (!markers.length) return <p className="p-5 text-sm text-muted">No coordinates recorded for the work in this queue. The queue and Schedule remain available.</p>;
  return <div className="h-[32rem] min-w-0"><LocationMap styleUrl={styleUrl} markers={markers} selectedId={selectedId} onSelect={id => router.push(`${selectionHref}&selected=${id}`, { scroll: false })}/></div>;
}
