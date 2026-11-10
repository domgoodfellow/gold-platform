/**
 * The one requirement catalogue behind public intake, sales discovery, and — as each arrives —
 * self-serve signup and onboarding confirmation. A key, its question and where it applies are
 * platform vocabulary (fixed in code, like `CAPABILITIES` or `MODULES`), never tenant-configured:
 * what GildOps asks a prospect is not a thing a business customizes.
 *
 * `operational_setup` is deliberately absent from every requirement's `applicableStages` today —
 * once a business exists, what it has already told GildOps belongs on the accepted-proposal
 * handoff (a later slice), not asked again through this catalogue.
 */
export type DiscoveryStage =
  | 'public_intake'
  | 'sales_discovery'
  | 'self_serve_signup'
  | 'onboarding_confirmation'
  | 'operational_setup';

export type DiscoveryRequirementKey =
  | 'productInterest'
  | 'contactChannels'
  | 'bookingIntake'
  | 'phoneHandling'
  | 'teamAccess'
  | 'websiteSurfaces'
  | 'customerSelfService'
  | 'workersResources'
  | 'locationConstraints'
  | 'quoteInvoiceModel'
  | 'postContactWorkflow'
  | 'automationGoals'
  | 'existingSoftware';

export type DiscoveryRequirement = {
  key: DiscoveryRequirementKey;
  /** Groups related requirements on a discovery screen — never a rule, just a heading. */
  category: string;
  /** What a form or a salesperson actually asks. */
  question: string;
  /** Every requirement here is freeform text today; a structured or multiple-choice answer has no caller yet. */
  answerType: 'text';
  /** Which discovery surfaces ask this — a requirement absent from a stage is simply not asked there. */
  applicableStages: readonly DiscoveryStage[];
  /** Advisory only: the requirement usually makes more sense once this one has an answer. Never a hard gate — a discovery conversation does not run in a fixed order. */
  dependsOn?: DiscoveryRequirementKey;
};

export const DISCOVERY_REQUIREMENTS: readonly DiscoveryRequirement[] = [
  {
    // What the consultation form names (`/demo?product=…`), with any answers that product asks.
    key: 'productInterest',
    category: 'Interest',
    question: 'Which product are they asking about, and what do they need from it?',
    answerType: 'text',
    applicableStages: ['public_intake', 'sales_discovery'],
  },
  {
    key: 'contactChannels',
    category: 'Communication',
    question: 'How do customers reach them today — phone, text, email, walk-in?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'bookingIntake',
    category: 'Work',
    question: 'How does work get booked or requested?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'phoneHandling',
    category: 'Communication',
    question: 'Who answers the phone today, and what happens to a call nobody picks up?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'teamAccess',
    category: 'People',
    question: 'How big is the team, and who would need their own login?',
    answerType: 'text',
    applicableStages: ['public_intake', 'sales_discovery'],
  },
  {
    key: 'websiteSurfaces',
    category: 'Website',
    question: 'What does their public website need to do?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'customerSelfService',
    category: 'Website',
    question: 'Should a customer be able to see their own jobs or invoices?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'workersResources',
    category: 'People',
    question: 'What crews, vehicles or equipment does work get assigned to?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'locationConstraints',
    category: 'Work',
    question: 'Does travel distance, weather or a service area limit where work happens?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'quoteInvoiceModel',
    category: 'Money',
    question: 'How does a job get quoted and invoiced today?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
    dependsOn: 'bookingIntake',
  },
  {
    key: 'postContactWorkflow',
    category: 'Work',
    question: 'What happens right after a customer first gets in touch?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
  },
  {
    key: 'automationGoals',
    category: 'Automation',
    question: 'What would they want to happen automatically, if anything?',
    answerType: 'text',
    applicableStages: ['sales_discovery'],
    dependsOn: 'postContactWorkflow',
  },
  {
    key: 'existingSoftware',
    category: 'Current tools',
    question: 'What do they use today for any of this?',
    answerType: 'text',
    applicableStages: ['public_intake', 'sales_discovery'],
  },
] as const;

export function discoveryRequirement(key: DiscoveryRequirementKey): DiscoveryRequirement {
  const requirement = DISCOVERY_REQUIREMENTS.find((entry) => entry.key === key);
  if (!requirement) throw new Error(`No discovery requirement has the key "${key}".`);
  return requirement;
}

/** Every requirement a given stage asks, in catalogue order. */
export function discoveryRequirementsFor(stage: DiscoveryStage): readonly DiscoveryRequirement[] {
  return DISCOVERY_REQUIREMENTS.filter((requirement) => requirement.applicableStages.includes(stage));
}
