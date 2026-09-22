import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_ENTITIES } from '@/lib/domain/fields/field-definitions';
import { resolveFieldEntity } from '@/app/organizations/[organizationId]/fields/field-entities';

const FIELDS = fileURLToPath(new URL('../../../app/organizations/[organizationId]/fields', import.meta.url));
const CUSTOM_FIELDS = fileURLToPath(new URL('../../../features/custom-fields/configuration', import.meta.url));

describe('Custom Fields entity views are URL-backed', () => {
  it('defaults invalid or absent entities to Customers and accepts the domain vocabulary', () => {
    expect(resolveFieldEntity(undefined)).toBe('customer');
    expect(resolveFieldEntity('unknown')).toBe('customer');
    for (const entity of CUSTOM_FIELD_ENTITIES) expect(resolveFieldEntity(entity)).toBe(entity);
  });

  it('loads only the resolved entity instead of looping five configurations', () => {
    const page = readFileSync(`${FIELDS}/page.tsx`, 'utf8');
    expect(page).toContain('resolveFieldEntity');
    expect(page).toContain('listFieldDefinitions(db, { organizationId, entityType })');
    expect(page).not.toContain('CUSTOM_FIELD_ENTITIES.map');
  });
});

describe('Custom Fields uses bounded Sheets', () => {
  const configuration = readFileSync(`${CUSTOM_FIELDS}/entity-fields-configuration.tsx`, 'utf8');
  const createSheet = readFileSync(`${CUSTOM_FIELDS}/create-field-sheet.tsx`, 'utf8');
  const editSheet = readFileSync(`${CUSTOM_FIELDS}/edit-field-sheet.tsx`, 'utf8');
  const form = readFileSync(`${CUSTOM_FIELDS}/field-form.tsx`, 'utf8');

  it('renders a compact table with one New field trigger, never an inline editor stack', () => {
    expect(configuration).toContain('DataTable');
    expect(configuration).toContain('CreateFieldSheet');
    expect(configuration).not.toContain('CreateFieldForm');
    expect(configuration).not.toContain('EditFieldForm');
  });

  it('fixes the active entity in the creation Sheet and retains conditional choices', () => {
    expect(createSheet).toContain('Sheet');
    expect(createSheet).toContain('entityType={entityType}');
    expect(form).toContain('name="entityType" value={entityType}');
    expect(form).toContain('offersOptions(kind)');
  });

  it('edits in a Sheet with immutable identity as plain metadata', () => {
    expect(editSheet).toContain('Sheet');
    expect(editSheet).toContain('Key');
    expect(editSheet).toContain('Type');
    expect(editSheet).toContain('Applies to');
  });

  it('uses action success state to close Sheets while errors stay in the forms', () => {
    const actions = readFileSync(`${FIELDS}/actions.ts`, 'utf8');
    expect(actions).toContain('created: true');
    expect(actions).toContain('updated: true');
    expect(createSheet).toContain('onCreated={() => setOpen(false)}');
    expect(editSheet).toContain('onUpdated={() => setOpen(false)}');
  });
});

describe('Custom Fields boundary: features/custom-fields owns presentation, the route owns its Server Actions', () => {
  const page = readFileSync(`${FIELDS}/page.tsx`, 'utf8');
  const nav = readFileSync(`${CUSTOM_FIELDS}/field-entity-nav.tsx`, 'utf8');
  const form = readFileSync(`${CUSTOM_FIELDS}/field-form.tsx`, 'utf8');

  it('keeps the route thin: composition only, no field editor implementation', () => {
    expect(page).not.toContain('DataTable');
    expect(page).not.toContain('<form');
    expect(page).toContain('FieldEntityNav');
    expect(page).toContain('EntityFieldsConfiguration');
  });

  it('has no field-entity-tabs.tsx left behind by the ViewNav migration', () => {
    expect(() => readFileSync(`${FIELDS}/field-entity-tabs.tsx`, 'utf8')).toThrow();
  });

  it('renders entity navigation as a server-safe ViewNav, not a client tab controller', () => {
    expect(nav).not.toContain("'use client'");
    expect(nav).toContain('ViewNav');
    expect(nav).not.toContain('usePathname');
    expect(nav).not.toContain('useRouter');
  });

  it('reaches its Server Actions from the route it does not own, never a copy of its own', () => {
    expect(form).toContain("from '@/app/organizations/[organizationId]/fields/actions'");
  });

  it('keeps actions.ts, field-entities.ts and page.tsx route-owned', () => {
    expect(() => readFileSync(`${FIELDS}/actions.ts`, 'utf8')).not.toThrow();
    expect(() => readFileSync(`${FIELDS}/field-entities.ts`, 'utf8')).not.toThrow();
  });
});
