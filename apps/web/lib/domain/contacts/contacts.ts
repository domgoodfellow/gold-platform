import type { Db } from '@/lib/db/types';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { requireActor } from '@/lib/domain/tenancy/actor';

import type { ContactLifecycle, LeadTemperature } from '../customers/classification';
export { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, classificationLabel, type ContactLifecycle, type LeadTemperature } from '../customers/classification';

export type ContactType = 'person' | 'company' | 'unspecified';
export type Contact = {
  contactType?: ContactType;
  companyId?: string | null;
  companyName?: string | null;
  lifecycle?: ContactLifecycle | null;
  leadTemperature?: LeadTemperature;
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Tenant-defined fields, governed by this organization's registry. */
  custom: CustomValues;
  /**
   * Where this relationship has got to, or null.
   *
   * Null for a business that has named no stages, and for a customer nobody has staged yet.
   * Both are ordinary: the platform seeds no pipeline, so an absent stage means this business
   * has said nothing rather than that something is missing.
   */
  stageId: string | null;
  createdAt: string;
};

const NAME_MAX = 200;

/**
 * Customers belonging to one organization.
 *
 * The `organizationId` filter here is an optimisation, not the boundary — RLS already
 * restricts the rows to organizations the caller belongs to. Passing an organization the
 * caller is not a member of returns nothing rather than raising, because that is what
 * "cannot observe" means: the row is not denied, it is not there.
 */
export async function listContacts(
  db: Db,
  input: { organizationId: string; limit?: number; search?: string; stageId?: string | null },
): Promise<Counted<Contact>> {
  let query = db
    .from('contacts')
    .select('id, name, email, phone, custom, stage_id, contact_type, lifecycle, lead_temperature, created_at', { count: 'exact' })
    .eq('organization_id', input.organizationId);

  const search = input.search?.trim().replace(/[%_,()]/g, ' ');
  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (input.stageId === null) query = query.is('stage_id', null);
  else if (input.stageId !== undefined) query = query.eq('stage_id', input.stageId);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'customers.list_failed');
  }

  return counted(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      // `custom` is `Json` in the generated types because that is all Postgres promises about
      // a jsonb column. A check constraint pins it to an object, and the trigger pins what may
      // be in it, so the narrowing here restates a guarantee the database already enforces.
      custom: (row.custom ?? {}) as CustomValues,
      stageId: row.stage_id,
      contactType: row.contact_type as ContactType,
      lifecycle: row.lifecycle as ContactLifecycle | null,
      leadTemperature: row.lead_temperature as LeadTemperature,
      createdAt: row.created_at,
    })),
    count,
  );
}

export const CONTACT_PAGE_SIZE = 25;

export type ContactPageFilter = {
  search?: string;
  contactType?: ContactType;
  companyId?: string;
  sort?: 'name' | 'company';
  lifecycle?: ContactLifecycle | 'unclassified';
  temperature?: LeadTemperature;
  /** `null` selects customers with no stage; `undefined` selects every stage. */
  stageId?: string | null;
  /** Exact match on the `industry` custom value. */
  industry?: string;
  website?: 'with' | 'without';
  /** Created at or after this instant; the Dashboard's New contacts uses now minus 30 days. */
  addedSince?: string;
  /** Needs review: an Unspecified identity or no lifecycle yet. Never inferred, only listed for a person to classify. */
  needsReview?: boolean;
  /** One-based. */
  page: number;
};

/**
 * One page of the customer directory, filtered in the database.
 *
 * `listContacts` reads up to 500 rows for the many callers that populate a picker. A directory
 * is different: it must page, and the count must describe the filtered set, not every customer,
 * so every filter here applies to both the rows and the total.
 */
export async function listContactPage(
  db: Db,
  input: { organizationId: string; filter: ContactPageFilter },
): Promise<Counted<Contact>> {
  const { filter } = input;
  let affiliatedIds: string[] | undefined;
  if (filter.companyId) {
    const {data,error} = await db.from('contact_affiliations').select('person_id').eq('organization_id', input.organizationId).eq('company_id',filter.companyId).eq('active',true);
    if(error) throw new DomainError(error.message,'contacts.affiliations_failed');
    affiliatedIds=(data ?? []).map(row=>row.person_id);
  }
  let query = db
    .from('contact_directory')
    .select('id, name, email, phone, custom, stage_id, contact_type, lifecycle, lead_temperature, directory_company_id, directory_company_name, created_at', { count: 'exact' })
    .eq('organization_id', input.organizationId);

  const search = filter.search?.trim().replace(/[%_,()]/g, ' ');
  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (filter.contactType) query=query.eq('contact_type',filter.contactType);
  if (affiliatedIds) query=query.in('id',[filter.companyId!,...affiliatedIds]);
  if (filter.stageId === null) query = query.is('stage_id', null);
  else if (filter.stageId !== undefined) query = query.eq('stage_id', filter.stageId);
  if (filter.lifecycle === 'unclassified') query = query.is('lifecycle', null);
  else if (filter.lifecycle) query = query.eq('lifecycle', filter.lifecycle);
  if (filter.temperature) query = query.eq('lead_temperature', filter.temperature);
  if (filter.industry) query = query.eq('custom->>industry', filter.industry);
  if (filter.website === 'with') query = query.not('custom->>website', 'is', null).neq('custom->>website', '');
  if (filter.website === 'without') query = query.or('custom->>website.is.null,custom->>website.eq.');
  if (filter.addedSince) query = query.gte('created_at', filter.addedSince);
  if (filter.needsReview) query = query.or('contact_type.eq.unspecified,lifecycle.is.null');

  const from = (filter.page - 1) * CONTACT_PAGE_SIZE;
  const { data, error, count } = await query
    .order(filter.sort==='company'?'company_sort':filter.sort === 'name' ? 'name' : 'created_at', { ascending: Boolean(filter.sort),nullsFirst:false })
    .order('contact_type')
    .order('id', { ascending: false })
    .range(from, from + CONTACT_PAGE_SIZE - 1);

  if (error) {
    throw new DomainError(error.message, 'customers.list_failed');
  }

  return counted(
    (data ?? []).map((row) => ({
      id: row.id!,
      name: row.name!,
      email: row.email,
      phone: row.phone,
      custom: (row.custom ?? {}) as CustomValues,
      stageId: row.stage_id,
      contactType: row.contact_type as ContactType,
      lifecycle: row.lifecycle as ContactLifecycle | null,
      leadTemperature: row.lead_temperature as LeadTemperature,
      createdAt: row.created_at!,
      companyId:row.directory_company_id,
      companyName:row.directory_company_name,
    })),
    count,
  );
}

/**
 * The address (or, failing that, the name) of each listed customer's first recorded location.
 *
 * Only what has been recorded. A customer with no location, or a location with neither an address
 * nor a label, gets no entry, so the directory shows a dash rather than a place inferred from a
 * company name or from a phone's area code.
 */
export async function listContactLocationLabels(
  db: Db,
  input: { organizationId: string; customerIds: string[] },
): Promise<Record<string, string>> {
  if (input.customerIds.length === 0) return {};

  const { data, error } = await db
    .from('customer_locations')
    .select('customer_id, created_at, locations(label, address)')
    .eq('organization_id', input.organizationId)
    .in('customer_id', input.customerIds)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'customers.locations_failed');
  }

  const labels: Record<string, string> = {};
  for (const row of data ?? []) {
    if (labels[row.customer_id]) continue;
    const location = Array.isArray(row.locations) ? row.locations[0] : row.locations;
    const text = (location?.address || location?.label || '').trim();
    if (text) labels[row.customer_id] = text;
  }
  return labels;
}

export async function createContact(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    email?: string;
    phone?: string;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
    contactType?: ContactType;
    companyId?: string;
    affiliationTitle?: string;
    lifecycle?: ContactLifecycle | null;
    leadTemperature?: LeadTemperature;
  },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A customer needs a name.', 'customers.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'customers.name_too_long',
    );
  }

  // Normalised the same way identity normalises a sign-in address, so "Ann@X.com" and
  // "ann@x.com" collide on the unique index instead of becoming two customers.
  const email = input.email?.trim().toLowerCase() || null;
  if (email !== null && !email.includes('@')) {
    throw new DomainError('That email address is not valid.', 'customers.email_invalid');
  }

  const phone = input.phone?.trim() || null;

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'customer',
    custom: input.custom,
  });

  const args = {
    p_organization_id: input.organizationId,
    p_name: name,
    // `supabase gen types` emits every function argument as non-null, because Postgres
    // records no nullability for parameters: `p_email text` accepts null and is meant to,
    // and the catalog has nowhere to say so. Generated types are authoritative for tables
    // and columns, not for function arguments (the forward-only migration rule, ADR-028). These two casts are the
    // whole of that gap in this codebase, and they assert what the migration already allows.
    p_email: email as string,
    p_phone: phone as string,
    p_custom: custom,
    p_lifecycle: input.lifecycle as string,
    p_lead_temperature: input.leadTemperature as string,
  };
  const { data, error } = input.contactType && input.contactType !== 'unspecified'
    ? await db.rpc('create_crm_contact', {...args,p_contact_type:input.contactType,p_company_id:input.companyId as string,p_title:input.affiliationTitle as string})
    : await db.rpc('create_contact',args);

  if (error) {
    // 23505 is the unique index doing its job. The message names the tenant-scoped rule,
    // because "duplicate key" is true and useless.
    if (error.code === '23505') {
      throw new DomainError(
        'A customer with that email already exists here.',
        'customers.email_taken',
      );
    }
    // 23514 is app.check_custom_fields refusing a payload the registry does not allow.
    // resolveCustom above catches this first for anything arriving through the domain, so
    // reaching here means the row was built somewhere that skipped it.
    if (error.code === '23514') {
      throw new DomainError(error.message, 'customers.custom_invalid');
    }
    throw new DomainError(error.message, 'customers.create_failed');
  }

  return data;
}

/**
 * One customer, or null.
 *
 * Null covers both "no such customer" and "not yours" without the caller being able to tell
 * them apart — RLS produces that indistinguishability for free, and a caller that tried to
 * distinguish them would be rebuilding the leak by hand.
 */
export async function getContact(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<Contact | null> {
  // contact_directory is the same security-invoker row plus a person's primary active company.
  const { data, error } = await db
    .from('contact_directory')
    .select('id, name, email, phone, custom, stage_id, contact_type, lifecycle, lead_temperature, created_at, directory_company_id, directory_company_name')
    .eq('organization_id', input.organizationId)
    .eq('id', input.customerId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'customers.get_failed');
  }
  if (!data) return null;

  return {
    id: data.id!,
    name: data.name!,
    email: data.email,
    phone: data.phone,
    custom: (data.custom ?? {}) as CustomValues,
    stageId: data.stage_id,
    contactType: data.contact_type as ContactType,
    lifecycle: data.lifecycle as ContactLifecycle | null,
    leadTemperature: data.lead_temperature as LeadTemperature,
    createdAt: data.created_at!,
    companyId: data.contact_type === 'person' ? data.directory_company_id : null,
    companyName: data.contact_type === 'person' ? data.directory_company_name : null,
  };
}

/**
 * Correct a customer, and move them along.
 *
 * **The path this repository went eight milestones without**, which nothing noticed because the
 * businesses built here create a customer and then work on their jobs. A business that works the
 * *customer* rather than the job — anybody selling — finds it on the first afternoon: a typo in a
 * phone number was permanent, and a relationship could not be moved anywhere because there was
 * nowhere to move it to.
 *
 * **Every field is the new value, including the ones that did not change.** A partial update
 * needs a way to say *leave this alone* that a screen cannot distinguish from *set this to
 * null*, and what a form has is a whole record. `update_customer` writes the row, validates the
 * custom payload against the registry and records the events, so no caller can do two of the
 * three.
 */
export async function updateContact(
  db: Db,
  input: {
    organizationId: string;
    customerId: string;
    name: string;
    email?: string;
    phone?: string;
    custom?: CustomInput;
    contactType?: ContactType;
    companyId?: string;
    affiliationTitle?: string;
    lifecycle?: ContactLifecycle | null;
    leadTemperature?: LeadTemperature;
    stageId?: string | null;
  },
): Promise<void> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A customer needs a name.', 'customers.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'customers.name_too_long',
    );
  }

  // Normalised exactly as creation normalises it, so an address edited into a different case is
  // the same address rather than a second customer.
  const email = input.email?.trim().toLowerCase() || null;
  if (email !== null && !email.includes('@')) {
    throw new DomainError('That email address is not valid.', 'customers.email_invalid');
  }

  const phone = input.phone?.trim() || null;

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'customer',
    custom: input.custom,
  });

  const { error } = await db.rpc('update_crm_contact', {
    p_contact_type: input.contactType ?? (await getContact(db,{organizationId:input.organizationId,customerId:input.customerId}))?.contactType ?? 'unspecified',
    p_organization_id: input.organizationId,
    p_contact_id: input.customerId,
    p_name: name,
    // The same two casts `createContact` carries, and the same reason: Postgres records no
    // nullability for function parameters, so the generated types cannot express one.
    p_email: email as string,
    p_phone: phone as string,
    p_custom: custom,
    p_lifecycle: input.lifecycle as string,
    p_lead_temperature: input.leadTemperature as string,
    p_stage_id: (input.stageId ?? null) as string,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'A customer with that email already exists here.',
        'customers.email_taken',
      );
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'customers.custom_invalid');
    }
    // 42501 is the function refusing a row this caller may not change, and it is deliberately
    // indistinguishable from the row not existing.
    if (error.code === '42501') {
      throw new DomainError(
        'That customer is not yours to change.',
        'customers.update_refused',
      );
    }
    throw new DomainError(error.message, 'customers.update_failed');
  }
}

/** Exact visible activity per contact, bounded by the directory page or dashboard preview. */
export async function listContactLastActivity(db: Db, input: {organizationId:string; customerIds:readonly string[]}): Promise<Record<string,string>> {
  const entries = await Promise.all([...new Set(input.customerIds)].map(async customerId => {
    const {data,error}=await db.from('customer_activity').select('occurred_at').eq('organization_id',input.organizationId).eq('customer_id',customerId).order('occurred_at',{ascending:false}).limit(1).maybeSingle();
    if(error)throw new DomainError(error.message,'customers.activity_failed');
    return data?.occurred_at ? [customerId,data.occurred_at] as const : null;
  }));
  return Object.fromEntries(entries.filter((entry):entry is readonly [string,string]=>entry!==null));
}


export async function listCompanies(db: Db, organizationId: string) {
 const {data,error}=await db.from('contacts').select('id,name').eq('organization_id',organizationId).eq('contact_type','company').order('name').limit(500);
 if(error) throw new DomainError(error.message,'contacts.companies_failed');
 return data ?? [];
}
export async function listAffiliations(db:Db,organizationId:string,contactId:string) {
 const {data,error}=await db.from('contact_affiliations').select('id,person_id,company_id,title,is_primary,active,person:contacts!contact_affiliations_organization_id_person_id_person_type_fkey(id,name),company:contacts!contact_affiliations_organization_id_company_id_company_ty_fkey(id,name)')
 .eq('organization_id',organizationId).or(`person_id.eq.${contactId},company_id.eq.${contactId}`).order('active',{ascending:false}).order('is_primary',{ascending:false});
 if(error) throw new DomainError(error.message,'contacts.affiliations_failed');
 return data ?? [];
}
