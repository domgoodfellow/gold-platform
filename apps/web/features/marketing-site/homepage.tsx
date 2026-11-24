import { Fragment } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { WebsiteSection } from '@gold/schemas';
import { ButtonLink } from '@/components/controls/button';
import { AvailabilityLabel } from '@/components/marketing/availability-label';
import { ClosingComposition } from './closing';
import { MarketingSection } from '@/components/marketing/marketing-page';
import { SectionView, type SectionDecorator } from '@/features/public-site/section-renderers';
import type { FormSectionContext } from '@/features/public-site/form-section';
import { FragmentGroup, type FragmentCell } from '@/features/visual-composition/fragment-group';
import { HERO, PROCESS, PRODUCT_GROUPS, TRUST } from './compositions';
import { homepageBlocks, type HomepageBlock } from './homepage-model';

type Block<K extends HomepageBlock['kind']> = Extract<HomepageBlock, { kind: K }>;

/** Which fragment of each product-group composition holds which product, and its material. */
const PRODUCT_FRAGMENTS = ['a', 'b', 'c'] as const;
const PRODUCT_MATERIALS = {
  tools: { a: 'porcelain', b: 'mist', c: 'cobalt' },
  ai: { a: 'porcelain', b: 'cobalt', c: 'mist' },
  connected: { a: 'mist', b: 'porcelain', c: 'porcelain', key: 'cobalt' },
} as const;
/** The fragment given the most room in its arrangement, whose product reads first. */
const LEADING_FRAGMENT: Partial<Record<keyof typeof PRODUCT_MATERIALS, string>> = { ai: 'a' };

/**
 * GildOps' homepage: its published sections, in published order, each drawn by a composition
 * of its own. The words, links and order come from the published revision; availability comes
 * from the product inventory. A section without a composition, or one whose content does not
 * fit it, is drawn by the shared renderer exactly as before.
 */
export function MarketingHomepage({ sections, context, decorate }: {
  sections: WebsiteSection[];
  context: FormSectionContext;
  /** Authoring chrome around each section's composition (the Studio canvas); never on the live page. */
  decorate?: SectionDecorator;
}) {
  return (
    <div data-marketing-home data-marketing-page>
      {homepageBlocks(sections).map((block) => {
        const rendered = renderBlock(block, context);
        return <Fragment key={block.section.id}>{decorate ? decorate(block.section, rendered) : rendered}</Fragment>;
      })}
    </div>
  );
}

function renderBlock(block: HomepageBlock, context: FormSectionContext) {
  switch (block.kind) {
    case 'hero': return <Hero block={block} />;
    case 'products': return <ProductGroup block={block} />;
    case 'process': return <Process block={block} />;
    case 'trust': return <Trust block={block} />;
    case 'closing': {
      const { section } = block;
      return (
        <ClosingComposition
          id={`closing-${section.id}`}
          heading={section.heading}
          body={section.body}
          primary={section.primaryCta}
          secondary={section.secondaryCta}
        />
      );
    }
    default:
      return (
        <MarketingSection kind={block.section.kind}>
          <SectionView section={block.section} context={context} anchored={block.anchored} />
        </MarketingSection>
      );
  }
}

function Hero({ block: { section, groups } }: { block: Block<'hero'> }) {
  const cells: FragmentCell[] = [
    {
      fragment: 'copy',
      className: 'ms-hero-copy',
      content: (
        <>
          <h1>{section.heading}</h1>
          <p>{section.body}</p>
          <div className="ms-hero-actions">
            <ButtonLink href={section.primaryCta.href} tone="primary">{section.primaryCta.label}</ButtonLink>
            {section.secondaryCta ? <a href={section.secondaryCta.href} className="ms-hero-secondary">{section.secondaryCta.label}</a> : null}
          </div>
        </>
      ),
    },
    ...groups.map((group, index): FragmentCell => ({
      fragment: (['first', 'second', 'third'] as const)[index]!,
      href: `#${group.key}`,
      className: 'ms-hero-group',
      content: (
        <>
          <span className="ms-hero-group-heading">{group.heading} <ArrowRight aria-hidden size={16} /></span>
          <span className="ms-hero-group-products">{group.products.join(' · ')}</span>
        </>
      ),
    })),
  ];
  return (
    <MarketingSection kind="hero">
      <FragmentGroup
        id={`hero-${section.id}`}
        composition={HERO}
        cells={cells}
        materials={{ copy: 'ground', first: 'porcelain', second: 'cobalt', third: 'mist', accent: 'mist', base: 'porcelain' }}
      />
    </MarketingSection>
  );
}

function SectionHeading({ id, heading, body }: { id: string; heading: string; body?: string }) {
  return (
    <header className="ms-section-heading">
      <h2 id={id}>{heading}</h2>
      {body ? <p>{body}</p> : null}
    </header>
  );
}

function ProductGroup({ block: { section, group, entries } }: { block: Block<'products'> }) {
  const headingId = `${group.key}-heading`;
  return (
    <MarketingSection kind="capabilities">
      <section id={group.key} aria-labelledby={headingId} className="ms-anchor">
        <SectionHeading id={headingId} heading={section.heading} body={section.body} />
        <FragmentGroup
          id={`products-${section.id}`}
          as="ul"
          composition={PRODUCT_GROUPS[group.key]}
          materials={PRODUCT_MATERIALS[group.key]}
          cells={entries.map(({ item, href, offering }, index) => ({
            key: offering.id,
            fragment: PRODUCT_FRAGMENTS[index]!,
            href,
            className: LEADING_FRAGMENT[group.key] === PRODUCT_FRAGMENTS[index] ? 'ms-product ms-product-lead' : 'ms-product',
            content: (
              <>
                <div className="ms-product-top">
                  <h3>{item.title}</h3>
                  <ArrowUpRight aria-hidden size={20} />
                </div>
                <AvailabilityLabel availability={offering.availability} className="ms-availability" />
                <p>{item.body}</p>
              </>
            ),
          }))}
        />
      </section>
    </MarketingSection>
  );
}

function Process({ block: { section } }: { block: Block<'process'> }) {
  const headingId = `process-${section.id}`;
  return (
    <MarketingSection kind="process">
      <section id="how-it-works" aria-labelledby={headingId} className="ms-anchor">
        <SectionHeading id={headingId} heading={section.heading} />
        <FragmentGroup
          id={`process-${section.id}`}
          as="ol"
          composition={PROCESS}
          materials={{ s1: 'porcelain', s2: 'mist', s3: 'porcelain', s4: 'mist' }}
          cells={section.items.map((item, index) => ({
            key: `${index}`,
            fragment: `s${index + 1}`,
            className: 'ms-step',
            content: (
              <>
                <span className="ms-step-number">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </>
            ),
          }))}
        />
      </section>
    </MarketingSection>
  );
}

function Trust({ block: { section } }: { block: Block<'trust'> }) {
  const headingId = `trust-${section.id}`;
  return (
    <MarketingSection kind="trust">
      <section aria-labelledby={headingId}>
        <FragmentGroup
          id={`trust-${section.id}`}
          composition={TRUST}
          materials={{ heading: 'ground', t1: 'quiet', t2: 'quiet', t3: 'quiet', t4: 'quiet' }}
          cells={[
            { fragment: 'heading', className: 'ms-trust-heading', content: <h2 id={headingId}>{section.heading}</h2> },
            ...section.items.map((item, index): FragmentCell => ({
              key: `${index}`,
              fragment: `t${index + 1}`,
              className: 'ms-trust',
              content: (
                <>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </>
              ),
            })),
          ]}
        />
      </section>
    </MarketingSection>
  );
}
