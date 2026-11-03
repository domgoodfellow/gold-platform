'use client';

import { useRouter } from 'next/navigation';
import { SelectField } from '@/components/controls/select-field';

/**
 * The Work type a directory shows. Choosing one opens that type's address straight away, which the
 * server built without the previous type's status. Without script it is an ordinary field of the
 * toolbar form, and the page drops a status that does not belong to the chosen type.
 */
export function WorkTypeSelect({ types, value, hrefs }: { types: { id: string; name: string }[]; value: string; hrefs: Record<string, string> }) {
  const router = useRouter();
  return <SelectField name="type" aria-label="Work type" defaultValue={value} className="w-full sm:w-48" onValueChange={(next) => { const href = hrefs[next]; if (href) router.push(href); }} options={[...types.map((type) => ({ value: type.id, label: type.name }))]} />;
}
