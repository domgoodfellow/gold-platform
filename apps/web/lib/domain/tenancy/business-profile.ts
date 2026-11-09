import { cache } from 'react';
import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

export const BUSINESS_NOUNS = {
  customer: { singular: 'Customer', plural: 'Customers' }, opportunity: { singular: 'Opportunity', plural: 'Opportunities' },
  work: { singular: 'Work item', plural: 'Work items' }, invoice: { singular: 'Invoice', plural: 'Invoices' },
  quote: { singular: 'Quote', plural: 'Quotes' }, resource: { singular: 'Resource', plural: 'Resources' },
  location: { singular: 'Location', plural: 'Locations' }, service: { singular: 'Service', plural: 'Services' },
} as const;
export type BusinessEntity = keyof typeof BUSINESS_NOUNS;
export type BusinessProfile = { revision: number; nouns: Partial<Record<BusinessEntity, { singular: string; plural: string }>>; navigation: string[]; labels: Record<string,string> };

export function businessNoun(profile: BusinessProfile | null, entity: BusinessEntity, plural = false): string {
  return (profile?.nouns[entity] ?? BUSINESS_NOUNS[entity])[plural ? 'plural' : 'singular'];
}

/** Resolve authored labels only. Record titles and user-authored content never pass through here. */
export function businessLabel(profile: BusinessProfile | null, label: string): string {
  const destinations: Record<string,string> = {Home:'home',Customers:'customers',Contacts:'customers',Pipeline:'opportunity-pipeline',Dialer:'calls',Inbox:'comms-inbox',Marketing:'marketing',Support:'support',Agents:'ai',Quotes:'finance-quotes',Invoices:'finance-invoices',Payments:'finance-payments',Work:'work',Schedule:'schedule',Resources:'resources',Locations:'locations',Assets:'assets',Calendar:'calendar',Tasks:'follow-ups','Follow-ups':'follow-ups'};
  const destination = destinations[label];
  if (destination && profile?.labels[destination]) return profile.labels[destination];
  const contactWords = profile?.nouns.customer;
  if (contactWords) {
    if (label === 'Contacts') return contactWords.plural;
    if (label === 'Contact') return contactWords.singular;
    for (const prefix of ['Add ', 'Edit ', 'New ', 'Create ']) if (label === `${prefix}contact`) return prefix + contactWords.singular.toLowerCase();
  }
  for (const [entity, defaults] of Object.entries(BUSINESS_NOUNS)) {
    const words = profile?.nouns[entity as BusinessEntity];
    if (!words) continue;
    for (const form of ['singular','plural'] as const) {
      if (label === defaults[form]) return words[form];
      for (const prefix of ['New ', 'Create ', 'Edit ', 'Delete ', 'Select ', 'No ', 'Add ']) {
        if (label === prefix + defaults[form].toLowerCase()) return prefix + words[form].toLowerCase();
        for (const suffix of [' yet', ' yet.', ' match these filters.', ' found.']) {
          if (label === prefix + defaults[form].toLowerCase() + suffix) return prefix + words[form].toLowerCase() + suffix;
        }
      }
    }
  }
  return label;
}

export const getBusinessProfile = cache(async (db: Db, organizationId: string): Promise<BusinessProfile | null> => {
  const {data,error} = await db.from('organization_business_profiles').select('revision,nouns,navigation,labels').eq('organization_id',organizationId).maybeSingle();
  if(error) throw fromDatabaseError(error, 'business_profile.read_failed');
  return data as BusinessProfile | null;
});

export async function saveBusinessProfile(db: Db, organizationId: string, profile: BusinessProfile): Promise<void> {
  const {error} = await db.rpc('save_business_profile',{p_organization_id:organizationId,p_revision:profile.revision,p_nouns:profile.nouns,p_navigation:profile.navigation,p_labels:profile.labels});
  if(error) throw fromDatabaseError(error, 'business_profile.save_failed');
}
