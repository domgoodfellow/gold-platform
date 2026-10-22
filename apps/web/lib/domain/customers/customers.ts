/** Temporary compatibility exports. Canonical identity lives in contacts/contacts.ts.
 * Retirement: docs/data.md, Approved CRM consolidation and compatibility retirement. */
export { listContacts as listCustomers, listContactPage as listCustomerPage,
 getContact as getCustomer, createContact as createCustomer, updateContact as updateCustomer,
 listContactLocationLabels as listCustomerLocationLabels, listContactLastActivity as listCustomerLastActivity,
 CONTACT_PAGE_SIZE as CUSTOMER_PAGE_SIZE,
 type Contact as Customer, type ContactPageFilter as CustomerPageFilter,
 CONTACT_LIFECYCLES, LEAD_TEMPERATURES, classificationLabel, type ContactLifecycle, type LeadTemperature
} from '../contacts/contacts';
