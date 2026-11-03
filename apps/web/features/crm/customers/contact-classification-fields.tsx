import { FormField } from '@/components/controls/form';
import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, classificationLabel } from '@/lib/domain/customers/classification';
import { SelectField } from '@/components/controls/select-field';

/** Independent classification controls shared by creation and correction. */
export function ContactClassificationFields({ id, lifecycle, temperature = 'unrated' }: { id: string; lifecycle?: string | null; temperature?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {/* A new contact is not necessarily a Lead (V1.4): creation starts Unclassified. An existing
        lifecycle cannot be cleared here, because the update keeps it when none is sent. */}
    <FormField id={`${id}-lifecycle`} label="Lifecycle">{field => <SelectField {...field} name="lifecycle" defaultValue={lifecycle ?? ''} options={[...(!lifecycle ? [{ value: '', label: 'Unclassified' }] : []), ...CONTACT_LIFECYCLES.map((value) => ({ value: value, label: classificationLabel(value) }))]} />}</FormField>
    <FormField id={`${id}-temperature`} label="Lead temperature">{field => <SelectField {...field} name="leadTemperature" defaultValue={temperature} options={[...LEAD_TEMPERATURES.map((value) => ({ value: value, label: classificationLabel(value) }))]} />}</FormField>
  </div>;
}
