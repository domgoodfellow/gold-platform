import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gild Field's Locations and Assets, finished: create form/sheet, table and the collection's
 * bounded row interactions all feature-owned, one Customer↔Location form used from both hosts,
 * and the assets list's latest-reading read down from one query per asset to one query total.
 * Source guards — nothing here mounts a component.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTES = `${WEB}/app/organizations/[organizationId]`;
const LOCATIONS = `${WEB}/features/locations`;
const ASSETS = `${WEB}/features/assets`;
const read = (path: string) => readFileSync(path, 'utf8');

describe('Locations create form/sheet are feature-owned', () => {
  it('the create form and sheet live under features/locations, not the route', () => {
    expect(existsSync(`${LOCATIONS}/create-location-form.tsx`)).toBe(true);
    expect(existsSync(`${LOCATIONS}/create-location-sheet.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/locations/create-location-sheet.tsx`)).toBe(false);
    expect(existsSync(`${ROUTES}/locations/location-forms.tsx`)).toBe(false);
  });

  it('the create form posts to the route-owned action by its full path, since it moved feature-side', () => {
    const form = read(`${LOCATIONS}/create-location-form.tsx`);
    expect(form).toContain("from '@/app/organizations/[organizationId]/locations/actions'");
  });

  it('the Sheet follows the Resource footer standard: form id, drawer-owned footer, pending state propagated', () => {
    const sheet = read(`${LOCATIONS}/create-location-sheet.tsx`);
    expect(sheet).toContain('PageDrawerFooter');
    expect(sheet).toContain('form={formId}');
    expect(sheet).toContain('onPendingChange={setPending}');
    expect(sheet).toContain('Cancel');
  });
});

describe('Locations table is feature-owned', () => {
  it('the route contains no inline DataTable schema', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page).not.toContain('<DataTable');
    expect(page).toContain('<LocationTable');
    const table = read(`${LOCATIONS}/location-table.tsx`);
    expect(table).toContain('<DataTable');
  });

  it('Coordinates is not a primary column — it is the row action for an editor, plain text for a viewer', () => {
    const table = read(`${LOCATIONS}/location-table.tsx`);
    const primary = table.slice(table.indexOf('columns={'), table.indexOf('mayEdit\n          ? ['));
    expect(primary).not.toMatch(/key: 'coordinates'/);
    expect(table).toContain('LocationCoordinatesDrawer');
  });
});

describe('coordinate UI is feature-owned, one implementation for list and detail', () => {
  it('LocationCoordinatesForm lives in the feature, not the route', () => {
    expect(existsSync(`${LOCATIONS}/location-coordinates-form.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/locations/location-forms.tsx`)).toBe(false);
  });

  it('the collection wraps it in a bounded drawer; the detail page renders it directly', () => {
    expect(existsSync(`${LOCATIONS}/location-coordinates-drawer.tsx`)).toBe(true);
    const drawer = read(`${LOCATIONS}/location-coordinates-drawer.tsx`);
    expect(drawer).toContain('LocationCoordinatesForm');
    expect(drawer).toContain('PageDrawer');

    const detail = read(`${LOCATIONS}/location-detail.tsx`);
    expect(detail).toContain('<LocationCoordinatesForm');
    expect(detail).not.toContain('LocationCoordinatesDrawer');
  });

  it('lookup only suggests — the save button is the explicit write, still distinct from look-up', () => {
    const form = read(`${LOCATIONS}/location-coordinates-form.tsx`);
    expect(form).toContain('value="save"');
    expect(form).toContain('value="look-up"');
    expect(form).toContain('Found. Check it, then save.');
    expect(form).toContain('cannot look an address up');
  });
});

describe('Customer↔Location linking is one form, used in both contexts', () => {
  it('LinkCustomerLocationForm is the only implementation', () => {
    expect(existsSync(`${LOCATIONS}/link-customer-location-form.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/locations/[locationId]/link-customer-form.tsx`)).toBe(false);

    const page = read(`${ROUTES}/locations/page.tsx`);
    const detail = read(`${LOCATIONS}/location-detail.tsx`);
    expect(page).toContain('LinkCustomerLocationForm');
    expect(detail).toContain('LinkCustomerLocationForm');
  });

  it('the collection offers both selects; the fixed-location host offers only the customer', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page).toContain('locations={locations.map(');
    const detail = read(`${LOCATIONS}/location-detail.tsx`);
    expect(detail).toContain('locationId={location.id}');
  });
});

describe('Locations route Server Actions remain route-owned', () => {
  it('actions.ts still lives under app/, both list and detail level', () => {
    expect(existsSync(`${ROUTES}/locations/actions.ts`)).toBe(true);
    expect(existsSync(`${ROUTES}/locations/[locationId]/actions.ts`)).toBe(true);
    const actions = read(`${ROUTES}/locations/actions.ts`);
    expect(actions).toContain("'use server'");
    expect(actions).toContain('export async function createLocationAction');
  });
});

describe('Assets create form/sheet are feature-owned, and RecordReadingForm is its own file', () => {
  it('the create form and sheet live under features/assets, not the route', () => {
    expect(existsSync(`${ASSETS}/create-asset-form.tsx`)).toBe(true);
    expect(existsSync(`${ASSETS}/create-asset-sheet.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/assets/create-asset-form.tsx`)).toBe(false);
    expect(existsSync(`${ROUTES}/assets/create-asset-sheet.tsx`)).toBe(false);
  });

  it('RecordReadingForm is no longer defined inside create-asset-form.tsx', () => {
    const createForm = read(`${ASSETS}/create-asset-form.tsx`);
    expect(createForm).not.toContain('export function RecordReadingForm');
    expect(existsSync(`${ASSETS}/record-reading-form.tsx`)).toBe(true);
    expect(read(`${ASSETS}/record-reading-form.tsx`)).toContain('export function RecordReadingForm');
  });

  it('the create form posts to the route-owned action by its full path, since it moved feature-side', () => {
    const form = read(`${ASSETS}/create-asset-form.tsx`);
    expect(form).toContain("from '@/app/organizations/[organizationId]/assets/actions'");
  });
});

describe('Assets table is feature-owned, and the list renders no full reading form per row', () => {
  it('the route contains no inline DataTable schema', () => {
    const page = read(`${ROUTES}/assets/page.tsx`);
    expect(page).not.toContain('<DataTable');
    expect(page).toContain('<AssetTable');
    const table = read(`${ASSETS}/asset-table.tsx`);
    expect(table).toContain('<DataTable');
  });

  it('the collection row action is a bounded drawer trigger, not two TextInputs and a submit expanded per row', () => {
    const table = read(`${ASSETS}/asset-table.tsx`);
    expect(table).toContain('RecordReadingDrawer');
    expect(table).not.toContain('<TextInput');
    expect(table).not.toContain('name="value"');
  });

  it('detail and list reuse the same RecordReadingForm — the detail page renders it directly, the list wraps it in a drawer', () => {
    const drawer = read(`${ASSETS}/record-reading-drawer.tsx`);
    expect(drawer).toContain('RecordReadingForm');
    const detail = read(`${ASSETS}/asset-detail.tsx`);
    expect(detail).toContain('<RecordReadingForm');
    expect(detail).not.toContain('RecordReadingDrawer');
  });
});

describe('Assets route Server Actions remain route-owned', () => {
  it('actions.ts still lives under app/, both list and detail level', () => {
    expect(existsSync(`${ROUTES}/assets/actions.ts`)).toBe(true);
    expect(existsSync(`${ROUTES}/assets/[assetId]/actions.ts`)).toBe(true);
    const actions = read(`${ROUTES}/assets/actions.ts`);
    expect(actions).toContain("'use server'");
    expect(actions).toContain('export async function createAssetAction');
  });
});

describe('the latest-reading read is one query, not one per asset', () => {
  it('listLatestAssetReadings exists and the list page calls it once, not inside a per-asset map', () => {
    const readings = read(`${WEB}/lib/domain/assets/readings.ts`);
    expect(readings).toContain('export async function listLatestAssetReadings(');

    const page = read(`${ROUTES}/assets/page.tsx`);
    expect(page).toContain('listLatestAssetReadings(db, {');
    expect(page).not.toMatch(/assets\.map\(async[\s\S]{0,200}listAssetReadings/);
  });

  it('the table receives a ready lookup rather than reading per row', () => {
    const table = read(`${ASSETS}/asset-table.tsx`);
    expect(table).toContain('latestReadings: Map<string, AssetReading>');
    expect(table).not.toContain('listAssetReadings(');
  });
});

describe('no calendar/map dependency arrived with Locations coordinates', () => {
  it('adds no map/tile library', () => {
    const packageJson = read(`${WEB}/package.json`);
    expect(packageJson).not.toMatch(/leaflet|mapbox|maplibre/i);
  });

  it('no Map tab or placeholder was added to Locations', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    const detail = read(`${LOCATIONS}/location-detail.tsx`);
    for (const source of [page, detail]) {
      expect(source).not.toMatch(/>Map</);
    }
  });
});

describe('Locations and Assets revalidate the Gild Field surfaces they change', () => {
  it('creating a Location refreshes Locations and Field, since Field Overview counts Locations', () => {
    const actions = read(`${ROUTES}/locations/actions.ts`);
    const createAction = actions.slice(actions.indexOf('export async function createLocationAction'), actions.indexOf('export async function linkCustomerAction'));
    expect(createAction).toContain(`revalidatePath(\`/organizations/\${organizationId}/locations\`)`);
    expect(createAction).toContain(`revalidatePath(\`/organizations/\${organizationId}/field\`)`);
  });

  it('creating an Asset refreshes Assets and Field, since Field Overview counts Assets', () => {
    const actions = read(`${ROUTES}/assets/actions.ts`);
    const createAction = actions.slice(actions.indexOf('export async function createAssetAction'), actions.indexOf('export async function recordReadingAction'));
    expect(createAction).toContain(`revalidatePath(\`/organizations/\${organizationId}/assets\`)`);
    expect(createAction).toContain(`revalidatePath(\`/organizations/\${organizationId}/field\`)`);
  });

  it('a coordinate save from the list refreshes both the list and that location’s own detail', () => {
    const actions = read(`${ROUTES}/locations/actions.ts`);
    const coordinatesAction = actions.slice(actions.indexOf('export async function locationCoordinatesAction'));
    expect(coordinatesAction).toContain(`revalidatePath(\`/organizations/\${organizationId}/locations\`)`);
    expect(coordinatesAction).toContain('/locations/${locationId}');
  });

  it('linking a customer from the list refreshes both the list and that location’s own detail', () => {
    const actions = read(`${ROUTES}/locations/actions.ts`);
    const linkAction = actions.slice(
      actions.indexOf('export async function linkCustomerAction'),
      actions.indexOf('export async function locationCoordinatesAction'),
    );
    expect(linkAction).toContain(`revalidatePath(\`/organizations/\${organizationId}/locations\`)`);
    expect(linkAction).toContain('/locations/${locationId}');
  });
});
