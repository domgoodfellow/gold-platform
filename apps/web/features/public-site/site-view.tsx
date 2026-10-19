import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { NavigationItem, PublicWebsiteSnapshot, WebsitePage } from '@gold/schemas';
import { BrandStyle } from '@/features/branding/brand-style';
import { FOCUS_RING, cx } from '@/components/class-names';
import { pagePath } from '@/lib/domain/public-site/paths';
import type { FormSectionContext } from './form-section';
import { PageSections } from './section-renderers';

/**
 * Where a page is, given where the site is being served: at a business's own hostname the root is
 * `/`; a private preview of a draft is `/preview/{organization}/{revision}` and every page below it.
 */
export function pageHref(page: Pick<WebsitePage, 'isHome' | 'slug'>, linkBase = ''): string {
  return page.isHome ? (linkBase || '/') : `${linkBase}${pagePath(page)}`;
}

function NavLink({ item, pages, current, linkBase }: { item: NavigationItem; pages: WebsitePage[]; current: WebsitePage; linkBase: string }) {
  const classes = cx('rounded px-1 py-0.5 text-sm text-muted transition hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground', FOCUS_RING);
  if (item.target.type === 'external') {
    return <a href={item.target.href} rel="noopener noreferrer" className={classes}>{item.label}</a>;
  }
  const target = item.target.pageId;
  const page = pages.find((entry) => entry.id === target);
  // Navigation naming a page that is not in this snapshot cannot happen in a stored revision (the
  // database refuses it), so a missing one is drawn as nothing rather than as a dead link.
  if (!page) return null;
  return <Link href={pageHref(page, linkBase)} aria-current={page.id === current.id ? 'page' : undefined} className={classes}>{item.label}</Link>;
}

/**
 * One page of a published (or previewed) website inside the business's own frame: its name and
 * logo, the navigation the business chose, the page's sections, and its contact details. Every
 * string in the frame is one the business wrote — nothing here is GildOps' voice. The same
 * view serves the public hostname and the private preview, so the two cannot drift.
 */
export function SiteView({ site, page, context, logoSrc = null, linkBase = '', banner }: {
  site: PublicWebsiteSnapshot;
  page: WebsitePage;
  context: FormSectionContext;
  logoSrc?: string | null;
  linkBase?: string;
  /** Preview chrome, outside the business's own frame. */
  banner?: ReactNode;
}) {
  const profile = site.profile;
  const contacts = [profile.contactPhone ? formatPhoneForDisplay(profile.contactPhone) : null, profile.contactEmail, profile.address].filter(Boolean);
  const home = site.pages.find((entry) => entry.isHome);

  return (
    <div data-brand>
      <BrandStyle brand={site.brand} />
      {banner}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4 sm:px-8">
          <Link href={home ? pageHref(home, linkBase) : '/'} className={cx('flex items-center gap-3 rounded', FOCUS_RING)}>
            {logoSrc ? (
              // A tenant's own upload in a public bucket, not a build-time asset — next/image would
              // need every deployment's storage host named in its config.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="" className="max-h-9 w-auto max-w-40 object-contain" />
            ) : null}
            <span className="font-semibold">{profile.displayName}</span>
          </Link>
          {site.navigation.length > 0 ? (
            <nav aria-label="Site" className="flex flex-wrap items-center gap-x-5 gap-y-1">
              {site.navigation.map((item) => <NavLink key={item.id} item={item} pages={site.pages} current={page} linkBase={linkBase} />)}
            </nav>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-6 sm:px-8">
        <PageSections sections={page.sections} context={{ ...context, linkBase: linkBase || undefined }} />
      </main>
      {contacts.length > 0 ? (
        <footer className="mt-8 border-t border-border">
          <p className="mx-auto w-full max-w-5xl px-6 py-6 text-sm text-muted sm:px-8">{profile.displayName} · {contacts.join(' · ')}</p>
        </footer>
      ) : null}
    </div>
  );
}
