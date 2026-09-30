'use client';

import type { PublicHomepageSections } from '@gold/schemas';
import { cx, FOCUS_RING } from '@/components/class-names';

const SECTION_LABEL: Record<PublicHomepageSections[number]['kind'], string> = {
  hero: 'Hero',
  problem: 'Problem',
  capabilities: 'Capabilities',
  process: 'Process',
  trust: 'Trust',
  cta: 'Closing action',
};

export type StructureSelection = 'page' | PublicHomepageSections[number]['kind'];

/**
 * Page, then the six sections in the schema's own fixed order (never reordered, added to or
 * removed here — that is a future work order, not this one). Selecting an entry identifies it
 * here, highlights it in Canvas and populates Inspector: one selection, three panes.
 */
export function WebsiteStructure({ sections, selected, onSelect }: {
  sections: PublicHomepageSections;
  selected: StructureSelection;
  onSelect: (selection: StructureSelection) => void;
}) {
  const rows: { key: StructureSelection; label: string }[] = [
    { key: 'page', label: 'Page' },
    ...sections.map((section) => ({ key: section.kind, label: SECTION_LABEL[section.kind] })),
  ];

  return (
    <nav aria-label="Website structure" className="flex flex-col gap-1">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => onSelect(row.key)}
          aria-current={selected === row.key ? 'true' : undefined}
          className={cx(
            'rounded px-2.5 py-2 text-left text-sm transition',
            FOCUS_RING,
            selected === row.key ? 'bg-foreground font-medium text-background' : 'text-muted hover:bg-secondary hover:text-foreground',
          )}
        >
          {row.label}
        </button>
      ))}
    </nav>
  );
}
