/**
 * The one place the public marketing site's commercial content lives. `/`, `/sales`,
 * `/operations`, `/customer-service`, `/how-it-works`, `/integrations` and `/pricing` all read
 * from here rather than each hard-coding its own copy, so a change to what GOLD sells is one
 * edit rather than six.
 *
 * This is content, not the public-site revision system: the homepage alone stays
 * database-backed and reviewable through `lib/domain/public-site`, because that is the one
 * surface a tenant's own analogous pages will eventually reuse. These six pages are GOLD's own
 * words about its own product, the same standing as this file's neighbours in `app/(marketing)`
 * before the revision system existed, and moving them into `public_pages` later is a data
 * migration, not a rewrite — every page here is one typed object away from becoming a revision.
 */

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
    summary: 'Every lead, call and follow-up in one pipeline instead of three.',
    tagline: 'Turn leads into customers without losing the conversation.',
    problem:
      'Leads come in by phone, form and word of mouth, and land in different places. Follow-up depends on someone remembering to do it, and by the time a job is booked nobody can see the calls and messages that got it there.',
    workflows: [
      { title: 'Pipeline', body: 'Every lead and customer in one place, at a stage your team defined.' },
      { title: 'Calls', body: 'Answer, place and log calls against the customer they belong to, automatically.' },
      { title: 'SMS and email', body: 'Message a customer from the same record their calls and jobs live on.' },
      { title: 'Follow-up', body: 'Automated reminders for the leads a person would otherwise forget.' },
      { title: 'Appointments', body: 'Book a call or a visit straight onto the schedule everyone else sees.' },
    ],
    featureGroups: [
      { title: 'Pipeline & customers', items: ['Pipeline stages your team defines', 'Full customer history', 'Custom fields for what you track'] },
      { title: 'Communication', items: ['Calling', 'SMS', 'Email', 'Conversation history on the customer record'] },
      { title: 'Follow-up & automation', items: ['Automated follow-up reminders', 'Rules for what happens next', 'Human review on anything consequential'] },
      { title: 'Visibility', items: ['Reporting on pipeline and outcomes', 'AI assistance drafting replies and summaries'] },
    ],
    connectsTo: [
      'A booked appointment lands straight on Operations’ schedule.',
      'A won deal becomes a job with its quote and customer history already attached.',
    ],
    integrations: ['Twilio', 'Resend'],
    faq: [
      { question: 'Does this replace our phone system?', answer: 'GOLD places and receives calls through Twilio and logs every one against the customer it concerns, so you keep a number and gain the history that used to live only in someone’s head.' },
      { question: 'Can we keep our existing pipeline stages?', answer: 'Pipeline stages are configured by your team, not fixed by GOLD — you set them to match how you actually sell.' },
      { question: 'Does the AI send messages on its own?', answer: 'No. AI can draft a reply or summarize a call; a person still decides what goes out.' },
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
      { title: 'Dispatch', body: 'Assign the right resource to the right job automatically.' },
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
      'A job’s calls and messages stay with it, because Sales and Customer Service write to the same customer record.',
      'Payments post against the invoice a quote created — never a second total.',
    ],
    integrations: ['Stripe'],
    faq: [
      { question: 'Can we use our own pricing?', answer: 'Yes — quotes and invoices price from your own catalogue: your services, your rates, your hours.' },
      { question: 'What happens if two jobs need the same van or technician?', answer: 'Scheduling refuses the double-booking outright rather than letting two jobs land on one resource.' },
      { question: 'Do we have to take payments through GOLD?', answer: 'Card payments run through Stripe under your own account; GOLD never holds the money.' },
    ],
  },
  {
    slug: 'customer-service',
    href: '/customer-service',
    outcome: 'Serve customers better',
    name: 'Customer Service',
    summary: 'Phone, SMS, email and your website in one conversation history.',
    tagline: 'Give customers one conversation with your business.',
    problem:
      'A customer calls, then texts, then emails, then fills in a form on your website — and whoever picks up next has no idea what already happened, so the customer explains everything again.',
    workflows: [
      { title: 'Phone', body: 'Calls answered and routed, with every one logged against the customer.' },
      { title: 'SMS & email', body: 'Message a customer without leaving the record their history is on.' },
      { title: 'Website assistant', body: 'Answer common questions on your site without a person typing every reply.' },
      { title: 'Booking', body: 'Let a customer book straight onto your schedule, in your business’s name.' },
      { title: 'Escalation', body: 'Hand a conversation to a person the moment it needs one.' },
    ],
    featureGroups: [
      { title: 'Channels', items: ['Phone', 'SMS', 'Email', 'Website conversations'] },
      { title: 'Continuity', items: ['One history per customer across every channel', 'Reception and call handling'] },
      { title: 'Self-service', items: ['Customer-facing booking', 'AI-assisted answers, with escalation to a person'] },
    ],
    connectsTo: [
      'Every conversation lands on the same customer record Sales and Operations already use — nobody explains themselves twice.',
      'A booking made through the website assistant lands straight on the schedule.',
    ],
    integrations: ['Twilio', 'Resend'],
    faq: [
      { question: 'Does the AI assistant talk to customers unsupervised?', answer: 'It answers what it’s configured to answer and hands off to a person for anything consequential — it does not act on a customer’s behalf.' },
      { question: 'Will our number and email stay the same?', answer: 'Yes — GOLD connects the number and inbox you already use rather than issuing new ones.' },
    ],
  },
];

export function productBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((product) => product.slug === slug);
}

export const HOW_IT_WORKS_STEPS: { title: string; body: string }[] = [
  { title: 'Show us how the business works', body: 'A short conversation about the work you do today — the tools you use, and where they fall short.' },
  { title: 'We configure your workspace', body: 'Your work types, pricing, hours and roles get set up in GOLD — not a template, your operation.' },
  { title: 'Connect the tools you already use', body: 'Your phone number, inbox and payments connect to the workspace rather than being replaced by new ones.' },
  { title: 'Test it with your team', body: 'Everyone who will use GOLD tries the real workflows before anything goes live.' },
  { title: 'Launch', body: 'You decide when it’s ready. Nothing goes live before you’ve reviewed it.' },
  { title: 'Improve and expand over time', body: 'Turn on more of GOLD as the business needs it, without starting over.' },
];

export interface PricingPackage {
  slug: ProductSlug;
  name: string;
  includes: string[];
}

export const PRICING_PACKAGES: PricingPackage[] = [
  { slug: 'sales', name: 'Sales', includes: ['Pipeline and customer records', 'Calling and messaging', 'Automated follow-up', 'Reporting and AI assistance'] },
  { slug: 'operations', name: 'Operations', includes: ['Jobs, scheduling and dispatch', 'Quotes, invoices and payments', 'Customer portal', 'Automation and reporting'] },
  { slug: 'customer-service', name: 'Customer Service', includes: ['Phone, SMS and email', 'Website assistant', 'Reception and booking', 'Escalation to a person'] },
];

export const PRICING_FACTORS: { title: string; body: string }[] = [
  { title: 'Which products you switch on', body: 'Sales, Operations and Customer Service are priced and enabled independently — use one, or all three.' },
  { title: 'Team size', body: 'How many people need a seat in the workspace.' },
  { title: 'Usage', body: 'Call minutes, messages and email volume, billed at what they cost to carry.' },
  { title: 'Managed setup', body: 'Whether GOLD configures the workspace for you or your team does it directly.' },
  { title: 'Integrations', body: 'Which of your existing tools and channels need connecting.' },
];

export const HOMEPAGE_FAQ: { question: string; answer: string }[] = [
  { question: 'What is GOLD?', answer: 'GOLD is one connected system for running a service business — sales, operations and customer service in one place instead of several disconnected tools.' },
  { question: 'Is GOLD a CRM?', answer: 'A CRM is part of it. GOLD also runs your scheduling, jobs, invoicing, payments and customer communication — the parts that happen after a lead becomes a customer.' },
  { question: 'Does GOLD replace all our existing software?', answer: 'Not necessarily. GOLD connects to the phone, email and payment tools you already use rather than requiring you to abandon them on day one.' },
  { question: 'What kinds of businesses fit GOLD?', answer: 'Service businesses that sell, schedule and deliver work — and need customer, communication and job information to stay in one place.' },
  { question: 'Can GOLD integrate with software we already use?', answer: 'See /integrations for what’s connected today. GOLD is built to connect to the tools a business already runs on, not replace them wholesale.' },
  { question: 'How does implementation work?', answer: 'See how it works: a conversation about how you run today, a configured workspace, a review with your team, then launch on your own timeline.' },
  { question: 'Do we have to change our entire operation at once?', answer: 'No — Sales, Operations and Customer Service can be switched on separately, in the order that matters to your business.' },
  { question: 'How does AI fit into GOLD?', answer: 'AI drafts, summarizes and assists across every product. It does not take consequential action or publish anything without a person reviewing it.' },
  { question: 'What happens after I request a demo?', answer: 'Someone from GOLD follows up to understand how your business runs today and show you the parts of GOLD that fit it.' },
];
