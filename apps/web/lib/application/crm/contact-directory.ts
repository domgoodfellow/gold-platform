import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, type ContactLifecycle, type LeadTemperature } from '@/lib/domain/customers/classification';
import type { ContactPageFilter, ContactType } from '@/lib/domain/contacts/contacts';

/** The Contacts directory's view as its URL states it: plain strings, possibly empty or unknown. */
export type ContactDirectoryQuery = {
  search?: string; contactType?: string; companyId?: string; sort?: string; group?: string;
  lifecycle?: string; temperature?: string; stage?: string; industry?: string; website?: string;
  added?: string; review?: string;
  /** `1`: archived contacts instead of active ones. */
  archived?: string;
};

/** The CRM Dashboard's New contacts window: the 30 days before the request. */
export function thirtyDaysAgo(now: Date) { return new Date(now.getTime() - 30 * 86400000).toISOString(); }

/**
 * What a directory view means as a database filter. The page and any action on "every contact in
 * this view" read the same view the same way, so they can never disagree about who matches.
 * Unknown values are ignored rather than trusted.
 */
export function directoryFilter(view: ContactDirectoryQuery, now: Date = new Date()): Omit<ContactPageFilter, 'page'> {
  return {
    search: view.search || undefined,
    contactType: ['person', 'company', 'unspecified'].includes(view.contactType ?? '') ? view.contactType as ContactType : undefined,
    companyId: view.companyId || undefined,
    sort: view.group === 'company' || view.sort === 'company' ? 'company' : view.sort === 'name' ? 'name' : undefined,
    lifecycle: view.lifecycle === 'unclassified' ? 'unclassified' : CONTACT_LIFECYCLES.includes(view.lifecycle as ContactLifecycle) ? view.lifecycle as ContactLifecycle : undefined,
    temperature: LEAD_TEMPERATURES.includes(view.temperature as LeadTemperature) ? view.temperature as LeadTemperature : undefined,
    stageId: view.stage === 'unstaged' ? null : view.stage || undefined,
    industry: view.industry || undefined,
    website: view.website === 'with' || view.website === 'without' ? view.website : undefined,
    addedSince: view.added === '30d' ? thirtyDaysAgo(now) : undefined,
    needsReview: view.review === '1',
    archived: view.archived === '1',
  };
}

/** Whether a view narrows the directory at all; an unfiltered view means every contact. */
export function directoryFiltered(view: ContactDirectoryQuery): boolean {
  return Boolean(view.contactType || view.companyId || view.lifecycle || view.temperature || view.search || view.stage || view.industry || view.website || view.added || view.review || view.archived);
}
