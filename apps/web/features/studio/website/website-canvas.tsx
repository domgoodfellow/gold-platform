'use client';

import type { WebsitePage } from '@gold/schemas';
import { SectionView } from '@/features/public-site/section-renderers';
import { cx, FOCUS_RING } from '@/components/class-names';
import { Hint } from '@/components/controls/inputs';
import { sectionLabel } from '@/lib/domain/public-site/section-registry';
import type { Selection } from './types';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: 'w-full max-w-none',
  tablet: 'w-full max-w-[48rem] mx-auto',
  mobile: 'w-full max-w-[23.5rem] mx-auto',
};

export const VIEWPORT_LABEL: Record<Viewport, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

/**
 * The page being edited, through the one production section renderer — never a second
 * approximation of it. Selection chrome (hover boundary, selected outline) is editor-only: it wraps
 * `SectionView`'s output rather than changing it, so nothing here can leak into the persisted
 * revision or the public page.
 */
export function WebsiteCanvas({ page, selected, onSelect, viewport, formNames }: {
  page: WebsitePage;
  formNames: Record<string, string>;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  viewport: Viewport;
}) {
  return (
    <div className={cx('transition-[max-width]', VIEWPORT_WIDTH[viewport])}>
      <div className="flex flex-col gap-6 rounded-lg border border-border bg-background p-4 sm:p-6">
        {page.sections.length === 0 ? (
          <Hint className="py-10 text-center">“{page.name}” has no sections yet. Use Add section to build it.</Hint>
        ) : null}
        {page.sections.map((section) => {
          const isSelected = selected !== 'page' && selected.sectionId === section.id;
          return (
            <div
              key={section.id}
              role="button"
              tabIndex={0}
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
                'block w-full rounded-lg border-2 border-transparent p-2 text-left transition hover:border-border',
                FOCUS_RING,
                isSelected && 'border-foreground',
              )}
            >
              <div inert data-public-design className="pointer-events-none">
                <SectionView section={section} anchored={false} context={{ mode: 'canvas', forms: {}, formNames }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
