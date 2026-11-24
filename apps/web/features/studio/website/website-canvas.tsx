'use client';

import type { MouseEvent, ReactNode } from 'react';
import type { WebsitePage, WebsiteSection } from '@gold/schemas';
import { PreviewFrame } from '@/components/display/preview-frame';
import { PREVIEW_VIEWPORTS, type PreviewViewport } from '@/components/display/preview-surface';
import { cx, FOCUS_RING } from '@/components/class-names';
import { Hint } from '@/components/controls/inputs';
import { ExperienceView, type ExperienceSite } from '@/features/public-site/experience-view';
import { sectionLabel } from '@/lib/domain/public-site/section-registry';
import type { SiteExperience } from '@/lib/domain/public-site/public-site';
import type { Selection } from './types';

export type Viewport = PreviewViewport;

/**
 * The page being edited, drawn by the same experience renderer as the live site and the private
 * preview (`ExperienceView`) — GildOps' marketing compositions for its own site, the business frame
 * for every other — inside an isolated viewport at the chosen reference width, so the page's own
 * breakpoints apply. Selection chrome (hover boundary, selected outline) wraps each section's
 * output and never changes it; links inside the page do not navigate while editing.
 */
export function WebsiteCanvas({ experience, site, page, logoSrc, selected, onSelect, viewport, formNames }: {
  experience: SiteExperience;
  site: Omit<ExperienceSite, 'pages' | 'navigation'> & Partial<Pick<ExperienceSite, 'pages' | 'navigation'>>;
  page: WebsitePage;
  logoSrc: string | null;
  formNames: Record<string, string>;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  viewport: Viewport;
}) {
  const decorate = (section: WebsiteSection, rendered: ReactNode) => {
    const isSelected = selected !== 'page' && selected.sectionId === section.id;
    return (
      <div
        role="button"
        tabIndex={0}
        data-canvas-section={section.id}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect({ sectionId: section.id });
          }
        }}
        onClick={() => onSelect({ sectionId: section.id })}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={`Select the ${sectionLabel(section.kind)} section`}
        className={cx(
          'relative block w-full cursor-pointer text-left transition',
          'after:pointer-events-none after:absolute after:inset-0 after:border-2 after:border-transparent hover:after:border-border',
          FOCUS_RING,
          isSelected && 'after:border-foreground',
        )}
      >
        <div inert className="pointer-events-none">{rendered}</div>
      </div>
    );
  };
  // Header and footer links stay visible but never leave the editor.
  const holdLinks = (event: MouseEvent) => { if ((event.target as Element).closest('a')) event.preventDefault(); };
  return (
    <div className="grid gap-3">
      {page.sections.length === 0 ? <Hint className="text-center">“{page.name}” has no sections yet. Use Add section to build it.</Hint> : null}
      <PreviewFrame key={viewport} title={`Canvas · ${page.name} · ${PREVIEW_VIEWPORTS[viewport].label}`} width={PREVIEW_VIEWPORTS[viewport].width} interactive publicDesign>
        <div onClickCapture={holdLinks}>
          <ExperienceView
            experience={experience}
            site={{ pages: site.pages ?? [page], navigation: site.navigation ?? [], profile: site.profile, brand: site.brand }}
            page={page}
            logoSrc={logoSrc}
            context={{ mode: 'canvas', forms: {}, formNames }}
            decorate={decorate}
          />
        </div>
      </PreviewFrame>
    </div>
  );
}
