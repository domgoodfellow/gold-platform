import { ViewNav } from '@/components/navigation/view-nav';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  type CustomFieldEntity,
} from '@/lib/domain/fields/field-definitions';

/**
 * Which entity's custom fields the page is showing — a `ViewNav` over `?entity=`, not a client
 * tab switch. Server-safe on purpose: the page's own navigation is a set of URLs, and reading one
 * needs no controller in the browser.
 */
export function FieldEntityNav({
  organizationId,
  entityType,
}: {
  organizationId: string;
  entityType: CustomFieldEntity;
}) {
  return (
    <ViewNav
      label="Custom field entity"
      current={entityType}
      views={CUSTOM_FIELD_ENTITIES.map((entity) => ({
        key: entity,
        label: CUSTOM_FIELD_ENTITY_LABELS[entity],
        href: entity === 'customer' ? `/organizations/${organizationId}/sales/configuration/fields` : entity === 'work_item' ? `/organizations/${organizationId}/work/configuration?tab=fields` : `/organizations/${organizationId}/settings/custom-fields?entity=${entity}`,
      }))}
    />
  );
}
