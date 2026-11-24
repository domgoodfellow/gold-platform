import type { ReactNode } from 'react';
import type { PublicWebsiteSnapshot, SiteExperience, WebsitePage } from '@gold/schemas';
import { MarketingFrame } from '@/features/marketing-site/frame';
import { MarketingHomepage } from '@/features/marketing-site/homepage';
import type { FormSectionContext } from './form-section';
import { PageSections, type SectionDecorator } from './section-renderers';
import { SiteView } from './site-view';

export type ExperienceSite = Pick<PublicWebsiteSnapshot, 'pages' | 'navigation' | 'profile' | 'brand'>;

/**
 * One page of a website revision as its experience draws it — the one choice of renderer for every
 * private surface: the revision preview, the Studio thumbnail, the Studio canvas and template
 * previews. The live hostname and GildOps' root use the same components (`SiteView`; the marketing
 * layout's `MarketingFrame` with `MarketingHomepage`), so the same revision, experience, brand and
 * width render the same content everywhere, apart from authoring chrome added through `decorate`.
 *
 * - `organization_website`: the business's own frame (`SiteView`).
 * - `gildops_marketing`: GildOps' marketing frame; the homepage through its code-owned compositions.
 *   Only the homepage of this site is served at GildOps' root; any other page here is drawn with the
 *   shared sections inside the same frame.
 *
 * `standalone` is the experience owning a browser window (the revision preview route); inside a
 * preview frame it is false.
 */
export function ExperienceView({ experience, site, page, context, logoSrc = null, linkBase = '', banner, decorate, standalone = false }: {
  experience: SiteExperience;
  site: ExperienceSite;
  page: WebsitePage;
  context: FormSectionContext;
  logoSrc?: string | null;
  linkBase?: string;
  banner?: ReactNode;
  decorate?: SectionDecorator;
  standalone?: boolean;
}) {
  if (experience === 'gildops_marketing') {
    return (
      <>
        {banner}
        <MarketingFrame brand={site.brand} profile={site.profile} logoUrl={logoSrc} standalone={standalone}>
          {page.isHome ? (
            <MarketingHomepage sections={page.sections} context={context} decorate={decorate} />
          ) : (
            <div data-marketing-page>
              <PageSections sections={page.sections} context={{ ...context, linkBase: linkBase || undefined }} decorate={decorate} />
            </div>
          )}
        </MarketingFrame>
      </>
    );
  }
  return <SiteView site={site} page={page} context={context} logoSrc={logoSrc} linkBase={linkBase} banner={banner} decorate={decorate} />;
}
