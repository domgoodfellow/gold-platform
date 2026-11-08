/**
 * Product help for operators: how to use GildOps. Distinct from the Support workspace, which is a
 * business serving its own customers. A small set, each grounded in a surface that exists; an
 * article names where something is done and who owns it, and leaves the screen to say the rest.
 */
export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  /** Path under `/organizations/{id}` of the surface the article is about, when there is one. */
  opens?: { label: string; path: string };
  sections: readonly { heading: string; body: readonly string[] }[];
};

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary: 'What a new business does first, and what launching changes.',
    opens: { label: 'Open Setup', path: 'setup' },
    sections: [
      { heading: 'Setup comes first', body: [
        'A new business starts in Setup. It lists what is finished, what still blocks launch, and where each thing is set up.',
        'Each item opens the workspace that owns it: working hours in Work, prices in Finance, phone routing in Communications. Setup does not copy those screens.',
      ] },
      { heading: 'Your business profile', body: [
        'Settings → General holds the business name, industry, primary address, contact details, time zone and currency. Only the details a workspace truly needs block launch; the rest can be added whenever you like.',
      ] },
      { heading: 'Launching', body: [
        'Launching is a deliberate step that moves the business from Setup to Live. Everything you set up stays; Setup remains available for review.',
      ] },
    ],
  },
  {
    slug: 'customers-and-crm',
    title: 'Customers and the CRM',
    summary: 'Where relationships, stages and follow-up live.',
    opens: { label: 'Open CRM', path: 'sales' },
    sections: [
      { heading: 'One customer record', body: [
        'The CRM workspace owns the relationship: who the customer is, where they are in your process, and what follow-up is due. Other workspaces show that record; they do not keep their own copy.',
      ] },
      { heading: 'Stages and extra details', body: [
        'Relationship stages and opportunity stages are set up in the CRM. Custom fields add details your business records about customers, jobs and places.',
      ] },
    ],
  },
  {
    slug: 'communications',
    title: 'Communications',
    summary: 'Calls, messages and email as part of the customer record.',
    opens: { label: 'Open Communications', path: 'comms' },
    sections: [
      { heading: 'Conversations', body: [
        'Communications keeps calls, messages and email as business conversations tied to the customer, rather than in individual inboxes.',
      ] },
      { heading: 'Numbers, routing and email', body: [
        'Phone numbers, call routing, call outcomes and the email domain you send from are set up in Communications. Connecting an outside account is done under Settings → Connections.',
      ] },
    ],
  },
  {
    slug: 'work-and-scheduling',
    title: 'Work and scheduling',
    summary: 'Work items, schedules, resources, locations and working hours.',
    opens: { label: 'Open Work', path: 'field' },
    sections: [
      { heading: 'What is set up in Work', body: [
        'The kinds of work you do, their stages, working hours, resources and locations are all set up in the Work workspace, next to the schedule they affect.',
      ] },
      { heading: 'Members and resources', body: [
        'A member is someone who can sign in. A resource is something that can be scheduled: a person, a vehicle or a room. One person can be a member, a resource, or both, and changing one does not change the other.',
      ] },
      { heading: 'Time zones', body: [
        'Your business time zone controls how times are shown and where days begin. Changing it does not move any scheduled work; only how its time is displayed changes.',
      ] },
    ],
  },
  {
    slug: 'finance',
    title: 'Quotes, invoices and payments',
    summary: 'Pricing, quoting, invoicing and getting paid.',
    opens: { label: 'Open Finance', path: 'finance' },
    sections: [
      { heading: 'Money your customers owe you', body: [
        'Finance holds the price book, quotes, invoices and payments between your customers and your business. Prices and wording are set up in Finance.',
      ] },
      { heading: 'Currency', body: [
        'The currency in Settings → General is used for new prices. Existing quotes and invoices keep the currency they were created in, and changing the setting never rewrites them.',
      ] },
      { heading: 'Your GildOps subscription is separate', body: [
        'What your business pays GildOps is under Settings → Plan & usage. It is not part of Finance.',
      ] },
    ],
  },
  {
    slug: 'automations',
    title: 'Automations',
    summary: 'Rules that run repeatable work for you.',
    opens: { label: 'Open Automations', path: 'automations' },
    sections: [
      { heading: 'Trigger, conditions, actions', body: [
        'An automation starts from a trigger, checks its conditions, then performs actions. Actions use the same operations and permission checks a person would, and every run is recorded in run history.',
      ] },
    ],
  },
  {
    slug: 'ai-agents',
    title: 'AI agents',
    summary: 'What the Agent can see and do, and how approvals work.',
    opens: { label: 'Open AI', path: 'ai' },
    sections: [
      { heading: 'Same permissions as you', body: [
        'The Agent can read only what you are allowed to read and use only the tools it has been granted. It does not have a separate copy of your data.',
      ] },
      { heading: 'Approvals', body: [
        'Where an action needs approval, the Agent proposes it and an authorised person approves it. Only then is the action carried out through the normal operation.',
      ] },
    ],
  },
  {
    slug: 'studio',
    title: 'Studio: website and forms',
    summary: 'Publishing your website, booking and forms.',
    opens: { label: 'Open Studio', path: 'studio' },
    sections: [
      { heading: 'Authoring and publishing', body: [
        'Studio is where you write, review and publish your public website, forms and templates. Publishing is a deliberate step; drafts are never public.',
      ] },
      { heading: 'Brand and domains', body: [
        'Your logo and colours are in Settings → Branding, and your GildOps address and any domain you own are in Settings → Domains. Studio uses them; it does not keep its own copies.',
      ] },
      { heading: 'What is public', body: [
        'The business address in Settings → General is private. Your public profile shows only what you enter there.',
      ] },
    ],
  },
  {
    slug: 'team-and-permissions',
    title: 'Team and permissions',
    summary: 'Members, invitations and roles.',
    opens: { label: 'Open Team & access', path: 'settings/access' },
    sections: [
      { heading: 'Members, invitations and roles', body: [
        'Settings → Team & access lists who can sign in to this business, the invitations still waiting, and the roles that decide what each person can do.',
      ] },
      { heading: 'Why a menu item may be missing', body: [
        'Some options only appear if your role allows them. If you need one, ask an administrator to change your role.',
      ] },
    ],
  },
  {
    slug: 'connecting-apps',
    title: 'Connecting other apps',
    summary: 'Connections to outside systems your business uses.',
    opens: { label: 'Open Connections', path: 'settings/connections' },
    sections: [
      { heading: 'What a connection is', body: [
        'A connection links your business to an outside application using an account your business owns. Connections show whether they are authorised and ready, and can be reconnected or disconnected at any time.',
      ] },
      { heading: 'Connecting is not setting up', body: [
        'A connection lets GildOps reach the other system. How a workspace uses it, such as call routing, stays in that workspace.',
      ] },
    ],
  },
];

export function findHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

/** Every word a search can match: title, summary and body. */
export function searchHelp(query: string, articles: readonly HelpArticle[] = HELP_ARTICLES): HelpArticle[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...articles];
  const scored = articles.map((article) => {
    const title = article.title.toLocaleLowerCase();
    const haystack = `${title} ${article.summary} ${article.sections.map((section) => `${section.heading} ${section.body.join(' ')}`).join(' ')}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return { article, score: -1 };
    const headings = article.sections.map((section) => section.heading).join(' ').toLocaleLowerCase();
    return { article, score: terms.reduce((sum, term) => sum + (title.includes(term) ? 3 : headings.includes(term) ? 2 : 1), 0) };
  });
  return scored.filter((entry) => entry.score >= 0).sort((a, b) => b.score - a.score).map((entry) => entry.article);
}
