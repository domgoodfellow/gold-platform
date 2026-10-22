export const CONTACT_LIFECYCLES = ['lead', 'prospect', 'customer'] as const;
export type ContactLifecycle = typeof CONTACT_LIFECYCLES[number];
export const LEAD_TEMPERATURES = ['unrated', 'cold', 'warm', 'hot'] as const;
export type LeadTemperature = typeof LEAD_TEMPERATURES[number];
export const classificationLabel = (value: string | null | undefined) => value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Unclassified';

