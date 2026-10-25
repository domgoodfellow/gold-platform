import { FormField } from '@/components/controls/form';
import { SelectInput } from '@/components/controls/inputs';
import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, classificationLabel } from '@/lib/domain/customers/classification';

/** Independent classification controls shared by creation and correction. */
export function ContactClassificationFields({ id, lifecycle, temperature = 'unrated' }: { id: string; lifecycle?: string | null; temperature?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {/* A new contact is not necessarily a Lead (V1.4): creation starts Unclassified. An existing
        lifecycle cannot be cleared here, because the update keeps it when none is sent. */}
    <FormField id={`${id}-lifecycle`} label="Lifecycle">{field => <SelectInput {...field} name="lifecycle" defaultValue={lifecycle ?? ''}>
      {!lifecycle ? <option value="">Unclassified</option> : null}
      {CONTACT_LIFECYCLES.map(value => <option key={value} value={value}>{classificationLabel(value)}</option>)}
    </SelectInput>}</FormField>
    <FormField id={`${id}-temperature`} label="Lead temperature">{field => <SelectInput {...field} name="leadTemperature" defaultValue={temperature}>
      {LEAD_TEMPERATURES.map(value => <option key={value} value={value}>{classificationLabel(value)}</option>)}
    </SelectInput>}</FormField>
  </div>;
}
