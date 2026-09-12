/** Public intake bounds, shared by browser affordances and authoritative domain validation. */
export const WORKFLOW_REVIEW_LIMITS = {
  name: 200,
  businessName: 200,
  email: 320,
  phone: 50,
  context: 4000,
  teamSize: 100,
  businessType: 200,
} as const;
