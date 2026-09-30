import { ViewNav } from '@/components/navigation/view-nav';
import { locationsViewHref, type LocationsView } from './locations-view';

/** List and Map, as `ViewNav`'s two sibling views — never a client Tabs standing in for the URL. */
export function LocationsViewNav({
  organizationId,
  view,
}: {
  organizationId: string;
  view: LocationsView;
}) {
  return (
    <ViewNav
      label="Locations views"
      current={view}
      views={[
        { key: 'list', label: 'List', href: locationsViewHref(organizationId, 'list') },
        { key: 'map', label: 'Map', href: locationsViewHref(organizationId, 'map') },
      ]}
    />
  );
}
