import axe from 'axe-core';

/**
 * Semantic accessibility, checked by behaviour rather than by reading source.
 *
 * **What this proves, and what it does not.** `axe-core` runs for real against a jsdom-rendered
 * tree, so name/role/state, label association, `aria-*` correctness and focus-order-adjacent
 * rules are real findings, not a source-string guess. It does **not** prove colour contrast, real
 * focus-visible rendering, or anything that needs an actual compositor — jsdom has no layout
 * engine, so those rule categories are disabled here rather than silently reported as passing.
 * This is deliberately named `runAxe` rather than `expectAccessible`: a clean result here is one
 * category of evidence among several (`docs/testing.md`'s taxonomy), never a claim that a surface
 * is fully accessible.
 */
const JSDOM_UNSUPPORTED_RULES = [
  // Needs rendered colour/contrast, which jsdom cannot compute.
  'color-contrast',
  // Needs real layout to know what overlaps or is visually hidden.
  'focus-order-semantics',
  'hidden-content',
];

export async function runAxe(container: Element): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    rules: Object.fromEntries(JSDOM_UNSUPPORTED_RULES.map((id) => [id, { enabled: false }])),
  });
  return results.violations;
}

/** The common assertion: no violation axe-core can actually detect under jsdom. */
export function describeViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`)
    .join('\n');
}
