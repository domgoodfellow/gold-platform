import type { SectionKind, SectionOf, WebsiteSection } from '@gold/schemas';
import { OFFERINGS, OFFERING_GROUPS, offeringHref, type Offering, type OfferingGroup } from '@/lib/marketing/content';

/**
 * The homepage's view model: GildOps' published sections, read alongside the product inventory,
 * as the blocks its compositions draw. Studio owns every word and link here; the inventory owns
 * each product's availability; this module only decides which composition can present a section
 * faithfully. A section no composition fits keeps the shared renderer, so authored content is
 * never dropped, reordered or given claims it did not make.
 */

export interface ProductEntry {
  item: SectionOf<'capabilities'>['items'][number];
  href: string;
  offering: Offering;
}

export type HomepageBlock =
  | { kind: 'hero'; section: SectionOf<'hero'>; groups: GroupSummary[] }
  | { kind: 'products'; section: SectionOf<'capabilities'>; group: OfferingGroup; entries: ProductEntry[] }
  | { kind: 'process'; section: SectionOf<'process'> }
  | { kind: 'trust'; section: SectionOf<'trust'> }
  | { kind: 'closing'; section: SectionOf<'cta'> }
  | { kind: 'shared'; section: WebsiteSection; anchored: boolean };

/** A composed product group as the hero points to it: the published heading and product titles. */
export interface GroupSummary {
  key: OfferingGroup['key'];
  heading: string;
  products: string[];
}

/** The products a section links to, when every one is a known product of a single group. */
function productGroup(section: SectionOf<'capabilities'>): { group: OfferingGroup; entries: ProductEntry[] } | null {
  if (section.items.length !== 3) return null;
  const entries = section.items.flatMap((item) => {
    const offering = item.href ? OFFERINGS.find((candidate) => offeringHref(candidate) === item.href) : undefined;
    return offering && item.href ? [{ item, href: item.href, offering }] : [];
  });
  if (entries.length !== 3) return null;
  const group = OFFERING_GROUPS.find((candidate) => candidate.key === entries[0]!.offering.group);
  if (!group || entries.some((entry) => entry.offering.group !== group.key)) return null;
  return { group, entries };
}

export function homepageBlocks(sections: WebsiteSection[]): HomepageBlock[] {
  const seen = new Set<SectionKind>();
  const groups = new Set<OfferingGroup['key']>();
  const blocks: HomepageBlock[] = sections.map((section): HomepageBlock => {
    const anchored = !seen.has(section.kind);
    seen.add(section.kind);
    const shared = { kind: 'shared', section, anchored } as const;
    switch (section.kind) {
      case 'hero':
        return anchored ? { kind: 'hero', section, groups: [] } : shared;
      case 'capabilities': {
        const match = productGroup(section);
        if (!match || groups.has(match.group.key)) return shared;
        groups.add(match.group.key);
        return { kind: 'products', section, ...match };
      }
      case 'process':
        return anchored && section.items.length === 4 ? { kind: 'process', section } : shared;
      case 'trust':
        return anchored && section.items.length === 4 ? { kind: 'trust', section } : shared;
      case 'cta':
        return { kind: 'closing', section };
      default:
        return shared;
    }
  });

  // The hero's cluster points to the product groups composed below it, and only those.
  const summaries = blocks.flatMap((block): GroupSummary[] => (
    block.kind === 'products'
      ? [{ key: block.group.key, heading: block.section.heading, products: block.entries.map((entry) => entry.item.title) }]
      : []
  ));
  return blocks.map((block) => {
    if (block.kind !== 'hero') return block;
    return summaries.length === 3 ? { ...block, groups: summaries } : { kind: 'shared', section: block.section, anchored: true };
  });
}
