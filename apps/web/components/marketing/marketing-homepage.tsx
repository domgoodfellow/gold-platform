import type { SectionKind, WebsiteSection } from '@gold/schemas';
import { SectionView } from '@/features/public-site/section-renderers';
import type { FormSectionContext } from '@/features/public-site/form-section';
import { KintsugiFracture } from './kintsugi-fracture';

/** Adds GildOps artwork around the canonical renderer, without styling tenant sites. */
export function MarketingHomepage({ sections, context }: { sections: WebsiteSection[]; context: FormSectionContext }) {
  const seen = new Set<SectionKind>();
  let products = 0;
  return (
    <div data-marketing-home>
      {sections.map((section) => {
        const anchored = !seen.has(section.kind);
        seen.add(section.kind);
        const variant = section.kind === 'capabilities'
          ? (['products', 'automation', 'connected'] as const)[products++ % 3]!
          : section.kind === 'hero' || section.kind === 'process' || section.kind === 'trust' || section.kind === 'cta'
            ? section.kind : 'bridge';
        return (
          <div key={section.id} className="marketing-home-section" data-marketing-section={section.kind}>
            <KintsugiFracture variant={variant} />
            <SectionView section={section} context={context} anchored={anchored} />
          </div>
        );
      })}
    </div>
  );
}
