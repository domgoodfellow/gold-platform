'use client';

import { useRouter } from 'next/navigation';
import { SelectInput } from '@/components/controls/inputs';

/**
 * The Work type a directory shows. Choosing one opens that type's address straight away, which the
 * server built without the previous type's status. Without script it is an ordinary field of the
 * toolbar form, and the page drops a status that does not belong to the chosen type.
 */
export function WorkTypeSelect({ types, value, hrefs }: { types: { id: string; name: string }[]; value: string; hrefs: Record<string, string> }) {
  const router = useRouter();
  return <SelectInput name="type" aria-label="Work type" defaultValue={value} className="w-full sm:w-48"
    onChange={event => { const href = hrefs[event.target.value]; if (href) router.push(href); }}>
    {types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
  </SelectInput>;
}
