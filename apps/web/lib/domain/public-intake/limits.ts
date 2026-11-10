/** Public intake bounds, shared by browser affordances and authoritative domain validation. */
export const PUBLIC_INTAKE_LIMITS = {
  name: 200,
  businessName: 200,
  email: 320,
  phone: 50,
  context: 4000,
  teamSize: 100,
  businessType: 200,
  topic: 100,
  /** A product's own answers, e.g. the Dialer's, as one line (lib/marketing/inquiry.ts). */
  needs: 1000,
} as const;

/** `demo` is a qualified sales request; `contact` is a general inquiry. Both land the same way. */
export type PublicInquiryKind = 'demo' | 'contact';

/** The topics `/contact` offers. The database stores the sender's word for it, not an enum. */
export const CONTACT_TOPICS = ['Sales', 'Existing customer', 'Partnership', 'Billing', 'General question'] as const;
