'use client';

import type { PublicHomepageSections } from '@gold/schemas';
import { HomepageSectionRenderer } from '@/features/public-site/homepage-renderer';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { StructureSelection } from './website-structure';

export type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: 'w-full max-w-none',
  tablet: 'w-full max-w-[48rem] mx-auto',
  mobile: 'w-full max-w-[23.5rem] mx-auto',
};

export const VIEWPORT_LABEL: Record<Viewport, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

/**
 * The actual homepage presentation, via the one production renderer — never a second
 * approximation of it. Selection chrome (hover boundary, selected outline) is editor-only: it
 * wraps `HomepageSectionRenderer`'s output rather than changing it, so nothing here can leak into
 * the persisted revision or the public page.
 */
export function WebsiteCanvas({ sections, selected, onSelect, viewport, formNames }: {
  sections: PublicHomepageSections;
  formNames: Record<string, string>;
  selected: StructureSelection;
  onSelect: (selection: StructureSelection) => void;
  viewport: Viewport;
}) {
  return (
    <div className={cx('transition-[max-width]', VIEWPORT_WIDTH[viewport])}>
      <div className="flex flex-col gap-6 rounded-lg border border-border bg-background p-4 sm:p-6">
        {sections.map((section) => {
          const isSelected = selected === section.kind;
          return (
            <button
              key={section.kind}
              type="button"
              onClick={() => onSelect(section.kind)}
              aria-current={isSelected ? 'true' : undefined}
              aria-label={`Select the ${section.kind} section`}
              className={cx(
                'block w-full rounded-lg border-2 border-transparent p-2 text-left transition hover:border-border',
                FOCUS_RING,
                isSelected && 'border-foreground',
              )}
            >
              <div className="pointer-events-none">
                <HomepageSectionRenderer section={section} forms={{ mode: 'canvas', forms: {}, formNames }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
