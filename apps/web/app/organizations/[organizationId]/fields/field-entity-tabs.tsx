'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  type CustomFieldEntity,
} from '@/lib/domain/fields/field-definitions';

/** Presentation follows the URL; reload and history therefore retain the active entity. */
export function FieldEntityTabs({ entityType }: { entityType: CustomFieldEntity }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Tabs value={entityType} onValueChange={(entity) => router.push(`${pathname}?entity=${entity}`)}>
      <TabsList className="max-w-full overflow-x-auto">
        {CUSTOM_FIELD_ENTITIES.map((entity) => (
          <TabsTrigger key={entity} value={entity}>
            {CUSTOM_FIELD_ENTITY_LABELS[entity]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
