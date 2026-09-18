import { PRODUCTS } from './content';

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
  { href: '/demo', label: 'Request a demo' },
] as const;

export const PRODUCT_LINKS = PRODUCTS.map((product) => ({ href: product.href, label: product.name }));

/** Every crawlable marketing path, in sitemap order. */
export const MARKETING_PATHS = [
  '/',
  ...PRODUCTS.map((product) => product.href),
  '/how-it-works',
  '/integrations',
  '/pricing',
  '/contact',
  '/demo',
  '/privacy',
  '/terms',
] as const;
