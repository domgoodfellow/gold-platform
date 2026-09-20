import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_ENTITIES } from '@/lib/domain/fields/field-definitions';
import { resolveFieldEntity } from '@/app/organizations/[organizationId]/fields/field-entities';

const FIELDS = fileURLToPath(new URL('../../../app/organizations/[organizationId]/fields', import.meta.url));

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
  const configuration = readFileSync(
    fileURLToPath(new URL('../../../features/fields/entity-fields-configuration.tsx', import.meta.url)),
    'utf8',
  );
  const createSheet = readFileSync(`${FIELDS}/create-field-sheet.tsx`, 'utf8');
  const editSheet = readFileSync(`${FIELDS}/edit-field-sheet.tsx`, 'utf8');
  const form = readFileSync(`${FIELDS}/create-field-form.tsx`, 'utf8');

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
