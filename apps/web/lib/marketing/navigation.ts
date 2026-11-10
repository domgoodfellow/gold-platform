import { OFFERINGS } from './content';

/**
 * Every link the marketing header and footer draw, in one list. `marketing-shell.test.ts` proves
 * each one resolves to a page in `app/(marketing)`, is publicly reachable, and is in the sitemap
 * and crawl policy — so a link added here cannot be dead, uncrawlable, or behind sign-in.
 */
export const COMPANY_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
] as const;

/** The header's plain links, after the Products menu. */
export const HEADER_LINKS = COMPANY_LINKS;

export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const;

export const ACCOUNT_LINKS = [
  { href: '/login', label: 'Log in' },
  { href: '/demo', label: 'Request a consultation' },
] as const;

/** The overview of everything GildOps offers; the Products menu and the footer both lead to it. */
export const PRODUCTS_OVERVIEW = { href: '/products', label: 'All products' } as const;

/** Products with a page of their own. Everything else is an entry on `/products`. */
export const PRODUCT_PAGES = OFFERINGS.filter((offering) => offering.page).map((offering) => ({
  href: offering.page!,
  label: offering.name,
}));

/** The footer's Products column: the overview, then every product page. */
export const PRODUCT_LINKS = [PRODUCTS_OVERVIEW, ...PRODUCT_PAGES];

/** Every crawlable marketing path, in sitemap order. */
export const MARKETING_PATHS = [
  '/',
  PRODUCTS_OVERVIEW.href,
  ...PRODUCT_PAGES.map((page) => page.href),
  '/how-it-works',
  '/integrations',
  '/pricing',
  '/contact',
  '/demo',
  '/privacy',
  '/terms',
] as const;
