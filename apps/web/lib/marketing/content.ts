/**
 * The one place the public marketing site's commercial content lives. The header and footer,
 * `/products`, `/dialer`, `/sales`, `/operations`, `/customer-service`, `/how-it-works` and
 * `/pricing` all read from here rather than each hard-coding its own copy, so a change to what
 * GildOps sells is one edit rather than eight.
 *
 * This is content, not the public-site revision system: the homepage alone stays database-backed
 * and edited in Studio, and its product rows link to the pages this file describes. Moving these
 * pages into a site revision later is a data migration, not a rewrite.
 *
 * **Never more than the catalogue says.** Each offering names the catalogue features its
 * description depends on and states its availability; `marketing-availability.test.ts` derives
 * that state from GildOps' commercial catalogue and fails when this file claims more. A claim that
 * rests on a feature the catalogue lists as planned is not made here. Prices are not published:
 * they are agreed in a quote, after a consultation.
 */

/**
 * Whether a business can have an offering today, as the commercial catalogue records it:
 * `available` when every feature it depends on is available and stable; `testing` when one is
 * partly built or its catalogue product is in beta or experimental; `not_yet` when one is planned,
 * its catalogue product is not on sale, or the catalogue does not list it at all.
 */
export type Availability = 'available' | 'testing' | 'not_yet';

export const AVAILABILITY: Record<Availability, { label: string; note: string }> = {
  available: { label: 'Available', note: 'We set it up with you after a consultation.' },
  testing: { label: 'In testing', note: 'It works today and is still being tested. We set it up with you after a consultation.' },
  not_yet: { label: 'Not yet available', note: 'Not yet available to new businesses. Ask now and we’ll tell you when it can be set up for you.' },
};

/** How a visitor gets an offering, which is the first thing they need to tell apart. */
export type OfferingGroupKey = 'tools' | 'ai' | 'connected';

export interface OfferingGroup {
  key: OfferingGroupKey;
  /** The group's heading on `/products` and in the Products menu. */
  name: string;
  /** How you get one, in a few words: shown beside each offering in the group. */
  access: string;
  /** One sentence under the group heading on `/products`. */
  summary: string;
}

export const OFFERING_GROUPS: OfferingGroup[] = [
  {
    key: 'tools',
    name: 'Individual tools',
    access: 'Use on its own',
    summary: 'Each one works without the rest of GildOps. Start where your team loses the most time.',
  },
  {
    key: 'ai',
    name: 'AI and automation',
    access: 'Set up with you',
    summary: 'We agree with you what it may do and when a person takes over, set it up, and your team tests it before customers see it.',
  },
  {
    key: 'connected',
    name: 'Connected business applications',
    access: 'Several products together',
    summary: 'Several products sharing one customer record, for teams that want sales, work and service in one place.',
  },
];

export interface Offering {
  /** Its anchor on `/products`, and its key. */
  id: string;
  group: OfferingGroupKey;
  name: string;
  /** The name as it reads mid-sentence: "Ask about the Dialer", "Ask about online booking". */
  inSentence: string;
  /** A few words for the Products menu. */
  menuLine: string;
  /** What it does, in a sentence or two. */
  summary: string;
  /** What a business needs before it can use it. */
  needs: string;
  /** What it works with, when a business has more than this one product. */
  worksWith: string;
  /** Its own page, when it has enough to say to deserve one. */
  page?: `/${string}`;
  availability: Availability;
  /** The catalogue features (`product.module.feature`) its description depends on. */
  catalogue: string[];
}

export const OFFERINGS: Offering[] = [
  {
    id: 'dialer',
    group: 'tools',
    name: 'Dialer',
    inSentence: 'the Dialer',
    menuLine: 'Business calls in the browser',
    summary: 'Make and take business calls in the browser, work through a call list, and record how each call went against the customer it was with.',
    needs: 'A computer with a microphone or headset, and a business phone number we set up for you.',
    worksWith: 'Sales, for calls on the pipeline. Customer Service, to open a support case from a call. The AI receptionist, which can pass callers to your team.',
    page: '/dialer',
    availability: 'not_yet',
    catalogue: [
      'comms.voice.browser_dialer',
      'comms.voice.outbound_calling',
      'comms.voice.inbound_calling',
      'comms.voice.call_controls',
      'comms.voice.call_history',
      'comms.voice.call_dispositions',
      'comms.voice.recording',
    ],
  },
  {
    id: 'websites',
    group: 'tools',
    name: 'Websites and forms',
    inSentence: 'websites and forms',
    menuLine: 'Pages and forms in your name',
    summary: 'Publish a website and forms in your business’s name. Edit a draft, check it, then publish. Every published version is kept, and an older one can be brought back as a new draft.',
    needs: 'Your wording, pictures and logo.',
    worksWith: 'Online booking, the website chat assistant, and Sales, where form responses arrive as enquiries.',
    availability: 'testing',
    catalogue: ['studio.website.pages_sections', 'studio.website.draft_review_publish', 'studio.forms_intake.contact_forms'],
  },
  {
    id: 'booking',
    group: 'tools',
    name: 'Online booking',
    inSentence: 'online booking',
    menuLine: 'Customers book a free time',
    summary: 'A public booking page where a customer picks a service and a free time without phoning. Each booking lands on your schedule, and times already taken are not offered.',
    needs: 'Your services, your hours and who does the work.',
    worksWith: 'Operations, where bookings become scheduled jobs, and Websites and forms.',
    availability: 'testing',
    catalogue: ['studio.public_booking.service_selection', 'studio.public_booking.availability_display', 'studio.public_booking.booking'],
  },
  {
    id: 'ai-receptionist',
    group: 'ai',
    name: 'AI receptionist',
    inSentence: 'the AI receptionist',
    menuLine: 'Answers calls to your number',
    summary: 'Answers calls to your business number using the information you approve. When a caller asks for a person, it passes the call to the people or number you choose. Every call is kept in your call history.',
    needs: 'A business phone number, the answers it may give, and who takes a call it passes on.',
    worksWith: 'The Dialer, so a passed-on call can ring in your team’s browser, and Customer Service.',
    availability: 'not_yet',
    catalogue: ['comms.voice.ai_receptionist'],
  },
  {
    id: 'website-assistant',
    group: 'ai',
    name: 'Website chat assistant',
    inSentence: 'the website chat assistant',
    menuLine: 'Answers questions on your site',
    summary: 'A chat window on your website that answers visitors’ questions from your published pages. A visitor can ask for a person at any time, and your team then replies in the same conversation.',
    needs: 'A published website with the information it should answer from.',
    worksWith: 'Websites and forms, and Customer Service, where your team answers the conversations.',
    // The catalogue does not list a website assistant yet.
    availability: 'not_yet',
    catalogue: [],
  },
  {
    id: 'automation',
    group: 'ai',
    name: 'Workflow automation',
    inSentence: 'workflow automation',
    menuLine: 'Rules for the routine steps',
    summary: 'Rules that act when something happens: send an email, update a customer, or create or move a job. Every run is recorded, so you can see what each rule did.',
    needs: 'The steps you repeat today, written down once.',
    worksWith: 'Sales and Operations, whose customers and jobs the rules act on.',
    availability: 'available',
    catalogue: [
      'automations.workflows.rule_authoring',
      'automations.triggers.domain_event_trigger',
      'automations.actions.email_action',
      'automations.actions.update_customer_action',
      'automations.actions.update_work_action',
      'automations.actions.create_work_action',
      'automations.runtime_review.run_history',
    ],
  },
  {
    id: 'assistant',
    group: 'ai',
    name: 'Business assistant',
    inSentence: 'the business assistant',
    menuLine: 'Ask about your business',
    summary: 'Ask about your customers, jobs and invoices in plain words, from any screen, and get answers built from records you can already see. It changes nothing unless a person approves.',
    needs: 'Nothing extra. It reads what your team already keeps in GildOps.',
    worksWith: 'Every connected application.',
    availability: 'testing',
    catalogue: ['agents.intelligence.ask_gold'],
  },
  {
    id: 'sales',
    group: 'connected',
    name: 'Sales',
    inSentence: 'Sales',
    menuLine: 'Customers, pipeline and tasks',
    summary: 'Customer records, a sales pipeline, tasks and email, with each customer’s history in one place.',
    needs: 'Your contacts, and the stages your sales go through.',
    worksWith: 'Operations, where a won sale becomes a job, and the Dialer.',
    page: '/sales',
    availability: 'available',
    catalogue: [
      'sales.customers_contacts.customer_profile',
      'sales.customers_contacts.activity_timeline',
      'sales.sales.pipeline',
      'sales.sales.configurable_stages',
      'sales.sales.follow_ups',
      'comms.email.sending',
    ],
  },
  {
    id: 'operations',
    group: 'connected',
    name: 'Operations',
    inSentence: 'Operations',
    menuLine: 'Jobs, schedule, invoices, payments',
    summary: 'Jobs, scheduling, dispatch, quotes, invoices and payments, connected from the first request to the payment.',
    needs: 'Your kinds of work, prices, hours, and the people or equipment that do the work.',
    worksWith: 'Sales and Customer Service, which write to the same customer record.',
    page: '/operations',
    availability: 'available',
    catalogue: [
      'field.work_management.work_items',
      'field.work_management.assignment',
      'field.scheduling.calendar',
      'field.scheduling.availability',
      'finance.quotes_estimates.quote_creation',
      'finance.invoicing.invoices',
      'finance.payments.card_payments',
    ],
  },
  {
    id: 'customer-service',
    group: 'connected',
    name: 'Customer Service',
    inSentence: 'Customer Service',
    menuLine: 'One history per customer',
    summary: 'Calls, email and website conversations in one history per customer, support cases for anything that needs resolving, and a portal where customers see their own jobs and invoices.',
    needs: 'The ways customers reach you today, and who answers them.',
    worksWith: 'Sales and Operations, the AI receptionist and the website chat assistant.',
    page: '/customer-service',
    availability: 'not_yet',
    catalogue: ['service.cases.case_records', 'comms.voice.inbound_calling', 'comms.email.sending', 'studio.customer_portal.portal_history'],
  },
];

export function offeringById(id: string): Offering | undefined {
  return OFFERINGS.find((offering) => offering.id === id);
}

/** Where a visitor asks about an offering: the consultation form with that product already chosen. */
export function consultationHref(offering?: Pick<Offering, 'id'>): string {
  return offering ? `/demo?product=${offering.id}` : '/demo';
}

/** Where an offering is read about: its own page, or its entry on `/products`. */
export function offeringHref(offering: Offering): string {
  return offering.page ?? `/products#${offering.id}`;
}

export function offeringsIn(group: OfferingGroupKey): Offering[] {
  return OFFERINGS.filter((offering) => offering.group === group);
}

/**
 * The Dialer's own page. Each feature is a part of the Dialer the application has
 * (`features/communications/voice`); the catalogue does not yet list the Dialer as available, so
 * the page says so and asks for a consultation rather than offering it.
 */
export const DIALER = {
  heading: 'A business phone your team uses in the browser.',
  body: 'Call customers and take their calls from GildOps, work through a list of people to call, and keep every call on the customer’s record. Nothing to install beyond a browser and a headset.',
  /** What it does, in the order a call happens. */
  phases: [
    {
      name: 'Before the call',
      items: [
        { title: 'A call list', body: 'Add the people to call, several at a time, with a reason for each. The list shows who is due first.' },
        { title: 'The customer in view', body: 'Choose someone from the list and their details and recent calls open beside the dial pad. Choosing never dials.' },
      ],
    },
    {
      name: 'On the call',
      items: [
        { title: 'Call or answer in the browser', body: 'Dial a number or a contact and choose which business number the customer sees. Incoming calls ring in the browser of whoever is taking calls.' },
        { title: 'Call controls', body: 'Mute, use the keypad, put someone on hold, bring in a colleague, or transfer the call with or without introducing it first.' },
      ],
    },
    {
      name: 'After the call',
      items: [
        { title: 'Outcome and notes', body: 'Record how it went using your own outcome names, add notes, and link the call to the right customer.' },
        { title: 'History and recordings', body: 'Look back through past calls by date and outcome. Where your business records calls, the people you allow can play them back.' },
      ],
    },
  ],
  /** What happens to a call nobody answers: one sentence, because it is the first thing an owner asks. */
  unanswered: 'A call nobody answers goes to the person or number you choose, or hears a message from you.',
  facts: [
    { title: 'Who it suits', body: 'Anyone whose day involves calling customers: a sales team working a list, an office returning enquiries, or an owner who wants business calls off a personal mobile.' },
    { title: 'Who may call', body: 'Each person who calls signs in with their own GildOps login. You choose who may place calls and who may play recordings.' },
    { title: 'What you need to start', body: 'A computer with a current browser, a microphone or headset, and a business phone number we set up for you.' },
    { title: 'What it costs', body: 'It depends on how many people make calls, how many numbers you need and how many call minutes you use. We quote it after a short conversation.' },
    { title: 'When you can have it', body: 'The Dialer is not yet available to new businesses. Tell us how your team calls and we’ll tell you when it can be set up for you.' },
  ],
  comparison: {
    heading: 'The Dialer and the AI receptionist do different jobs.',
    dialer: 'Your team makes and takes the calls, with the call list, the customer’s history and the outcome in front of them.',
    receptionist: 'An AI answers calls to your number with information you approve, and passes the caller to your team when a person is needed. It is not yet available to new businesses; when it is, it is set up with you and tested before it answers customers.',
    together: 'Used together, the receptionist answers first and passes callers to the people taking calls in the Dialer.',
  },
  faq: [
    { question: 'Do we need desk phones or an app?', answer: 'No. Calls are made and taken in the browser, on a computer with a microphone or headset.' },
    { question: 'Will we be able to use the Dialer without the rest of GildOps?', answer: 'Yes. The Dialer comes with contacts, the call list and call history. Other products can be added later, and the calls already made stay on the same customer records.' },
    { question: 'What happens to a call if I close the tab?', answer: 'The call carries on for the customer, but you are no longer on it. Moving between pages in GildOps keeps you on the call.' },
    { question: 'Who can listen to recordings?', answer: 'Only the people you allow to play recordings, and only your own business’s calls.' },
  ],
};

export type ProductSlug = 'sales' | 'operations' | 'customer-service';

export interface Product {
  slug: ProductSlug;
  href: `/${ProductSlug}`;
  /** The card headline on the homepage — an outcome, not a feature list. */
  outcome: string;
  /** The product's own name, used in navigation and page titles. */
  name: string;
  /** One line under the outcome, on the homepage card. */
  summary: string;
  /** The product page's own hero line. */
  tagline: string;
  /** The problem this product exists to remove. */
  problem: string;
  workflows: { title: string; body: string }[];
  featureGroups: { title: string; items: string[] }[];
  connectsTo: string[];
  integrations: string[];
  faq: { question: string; answer: string }[];
}

export const PRODUCTS: Product[] = [
  {
    slug: 'sales',
    href: '/sales',
    outcome: 'Sell more',
    name: 'Sales',
    summary: 'Every lead, task and follow-up in one pipeline instead of three.',
    tagline: 'Turn leads into customers without losing the conversation.',
    problem:
      'Leads come in by phone, form and word of mouth, and land in different places. Follow-up depends on someone remembering to do it, and by the time a job is booked nobody can see the calls and messages that got it there.',
    workflows: [
      { title: 'Pipeline', body: 'Every lead and customer in one place, at a stage your team defined.' },
      { title: 'Email', body: 'Email a customer from the same record their history and jobs live on.' },
      { title: 'Tasks', body: 'A dated task for every follow-up, so a lead does not depend on someone remembering it.' },
      { title: 'Appointments', body: 'Book a call or a visit straight onto the schedule everyone else sees.' },
    ],
    featureGroups: [
      { title: 'Pipeline & customers', items: ['Pipeline stages your team defines', 'Full customer history', 'Custom fields for what you track'] },
      { title: 'Communication', items: ['Email', 'Conversation history on the customer record', 'Calls, with the Dialer, when it is available'] },
      { title: 'Follow-up & automation', items: ['Tasks with due dates', 'Rules for what happens next', 'Human review on anything consequential'] },
      { title: 'Visibility', items: ['Reporting on pipeline and outcomes'] },
    ],
    connectsTo: [
      'A booked appointment lands straight on Operations’ schedule.',
      'A won deal becomes a job with its quote and customer history already attached.',
    ],
    integrations: ['Resend'],
    faq: [
      { question: 'Does this replace our phone system?', answer: 'Not yet. Calls in GildOps are made and taken in the Dialer, which is not yet available to new businesses. Sales works without it: your contacts, pipeline, tasks and email stay on one customer record.' },
      { question: 'Can we keep our existing pipeline stages?', answer: 'Pipeline stages are set by your team, not fixed by GildOps — you set them to match how you actually sell.' },
      { question: 'Does the AI send messages on its own?', answer: 'No. AI in GildOps answers your team’s questions about your records and changes nothing unless a person approves.' },
    ],
  },
  {
    slug: 'operations',
    href: '/operations',
    outcome: 'Run the operation',
    name: 'Operations',
    summary: 'Jobs, schedules, quotes and payments, connected from request to paid.',
    tagline: 'Know what needs to happen, who is doing it, and what happens next.',
    problem:
      'Jobs get tracked in a spreadsheet, scheduling happens in a calendar nobody else can see, and the quote, the invoice and the payment are three separate places to check before anyone can say whether a job made money.',
    workflows: [
      { title: 'Jobs', body: 'Every job tracked from request to completion, with its own history.' },
      { title: 'Scheduling', body: 'One schedule your whole team sees, with no double-booking.' },
      { title: 'Dispatch', body: 'Assign the right resource to the right job.' },
      { title: 'Quotes & invoices', body: 'Price a job from your own catalogue and invoice from the same numbers.' },
      { title: 'Payments', body: 'Take payment against the invoice it belongs to, and see it land.' },
    ],
    featureGroups: [
      { title: 'Work', items: ['Jobs and work items', 'Scheduling and dispatch', 'Resources and locations'] },
      { title: 'Money', items: ['Quotes from your own price book', 'Invoices', 'Payments', 'Job-level margin, where it can be known'] },
      { title: 'Customers', items: ['A customer portal in your business’s own name', 'Booking without a phone call'] },
      { title: 'Automation & reporting', items: ['Automation for defined steps', 'Reporting across jobs and customers'] },
    ],
    connectsTo: [
      'A job’s customer history stays with it, because Sales writes to the same customer record.',
      'Payments post against the invoice a quote created — never a second total.',
    ],
    integrations: ['Stripe'],
    faq: [
      { question: 'Can we use our own pricing?', answer: 'Yes — quotes and invoices price from your own catalogue: your services, your rates, your hours.' },
      { question: 'What happens if two jobs need the same van or technician?', answer: 'Scheduling refuses the double-booking outright rather than letting two jobs land on one resource.' },
      { question: 'Do we have to take payments through GildOps?', answer: 'Card payments run through Stripe under your own account; GildOps never holds the money.' },
    ],
  },
  {
    slug: 'customer-service',
    href: '/customer-service',
    outcome: 'Serve customers better',
    name: 'Customer Service',
    summary: 'Phone, email and your website in one conversation history.',
    tagline: 'Give customers one conversation with your business.',
    problem:
      'A customer calls, then texts, then emails, then fills in a form on your website — and whoever picks up next has no idea what already happened, so the customer explains everything again.',
    workflows: [
      { title: 'Phone', body: 'Calls answered and routed, with every one logged against the customer.' },
      { title: 'Email', body: 'Email a customer without leaving the record their history is on.' },
      { title: 'Booking', body: 'Let a customer book straight onto your schedule, in your business’s name.' },
      { title: 'Escalation', body: 'Hand a conversation to a person the moment it needs one.' },
    ],
    featureGroups: [
      { title: 'Channels', items: ['Phone', 'Email', 'Website conversations'] },
      { title: 'Continuity', items: ['One history per customer across every channel', 'Reception and call handling'] },
      { title: 'Self-service', items: ['Customer-facing booking'] },
    ],
    connectsTo: [
      'Every conversation lands on the same customer record Sales and Operations already use — nobody explains themselves twice.',
    ],
    integrations: ['Twilio', 'Resend'],
    faq: [
    ],
  },
];

export function productBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((product) => product.slug === slug);
}

export const HOW_IT_WORKS_STEPS: { title: string; body: string }[] = [
  { title: 'Tell us what needs fixing', body: 'A short conversation about the task you want help with, the tools you use today, and where they fall short.' },
  { title: 'We set it up for your business', body: 'The products you chose, set up with your own numbers, wording, hours, prices and roles. Not a template.' },
  { title: 'Test it with your team', body: 'The people who will use it try it on real work, and anything an AI assistant says is reviewed, before customers see it.' },
  { title: 'Launch', body: 'You decide when it’s ready. Nothing goes live before you’ve reviewed it.' },
  { title: 'Add more when it helps', body: 'Add another product when the business needs it. What is already set up stays as it is.' },
];

export interface PricingPackage {
  key: 'start' | 'operate' | 'scale' | 'enterprise';
  name: string;
  summary: string;
}

export const PRICING_PACKAGES: PricingPackage[] = [
  { key: 'start', name: 'Start', summary: 'For a smaller business beginning to run meaningful parts of its operation through GildOps.' },
  { key: 'operate', name: 'Operate', summary: 'For an established small business running sales, work and finance together.' },
  { key: 'scale', name: 'Scale', summary: 'For higher volume: more users, more automation and more included usage.' },
  { key: 'enterprise', name: 'Enterprise', summary: 'Volume, allowances, onboarding, support and terms agreed with you.' },
];

export const PRICING_FACTORS: { title: string; body: string }[] = [
  { title: 'Which products', body: 'A single tool such as online booking, AI and automation set up with you, or several connected applications.' },
  { title: 'Which plan', body: 'Start, Operate, Scale or Enterprise. Enterprise is priced by agreement.' },
  { title: 'Add-ons', body: 'Extra users and calling users, local phone numbers, AI Standard or AI Pro, advanced routing, premium support, and one-time implementation or migration.' },
  { title: 'Team size', body: 'How many people need a seat in the workspace.' },
  { title: 'Usage', body: 'Call minutes, messages and email volume.' },
  { title: 'Managed setup', body: 'Whether GildOps sets up the workspace for you or your team does it directly.' },
  { title: 'Integrations', body: 'Which of your existing tools and channels need connecting.' },
];
