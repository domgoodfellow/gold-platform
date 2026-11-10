import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The `/demo` route's own words, by source scan — the same convention every other
 * marketing/navigation suite here uses, for the same reason: no harness in this repository mounts
 * a server component.
 */

const ROUTE = fileURLToPath(new URL('../../../app/(marketing)/demo', import.meta.url));
const page = readFileSync(`${ROUTE}/page.tsx`, 'utf8');
const form = readFileSync(`${ROUTE}/demo-form.tsx`, 'utf8');
const actions = readFileSync(`${ROUTE}/actions.ts`, 'utf8');
const access = readFileSync(
  fileURLToPath(new URL('../../../lib/route/access.ts', import.meta.url)),
  'utf8',
);

/** The thank-you the form shows once the request is accepted. */
const successBranch = form.slice(form.indexOf('if (state.done)'), form.indexOf('<DemoFields'));

describe('the route is reachable with no session', () => {
  it('is listed in the proxy\'s closed set of public paths', () => {
    expect(access).toMatch(/'\/demo'/);
  });

  it('no longer lists the old /workflow-review path', () => {
    expect(access).not.toMatch(/'\/workflow-review'/);
  });
});

describe('the form asks for a conversation, not an account', () => {
  it('says up front that filling it in creates no account and no business', () => {
    expect(page).toMatch(/does not create an account/i);
  });

  it('does not offer the fields Business Setup asks for', () => {
    // Distinguishing this from the guided setup flow it is not, matching the earlier slice's
    // instruction not to let a public form imply Business Setup has begun.
    expect(page + form).not.toMatch(/work item type|operating hours|price book/i);
  });

  it('uses customer-facing consultation language, not internal "workflow review" wording', () => {
    expect(page + form).not.toMatch(/workflow review/i);
    expect(page).toContain('Request a consultation');
    expect(form).toContain('Request a consultation');
  });

  it('never sends the visitor to account creation: no product is bought by signing up', () => {
    expect(page + form).not.toContain('/sign-up');
  });
});

describe('the success experience', () => {
  it('thanks the visitor, names the product they asked about, and promises a consultation', () => {
    expect(successBranch).toMatch(/we.{0,10}ll review what you shared[\s\S]{0,80}contact you to arrange a consultation/i);
    expect(successBranch).toContain('state.product');
  });

  it('makes no response-time promise', () => {
    expect(form).not.toMatch(/\b\d+\s*(hours?|minutes?|days?|business days?)\b/i);
  });

  it('offers a way back home and a way to log in', () => {
    expect(successBranch).toMatch(/href="\/"/);
    expect(successBranch).toMatch(/href="\/login"/);
  });
});

describe('the product the visitor came from travels with the request', () => {
  it('reads ?product= and opens the form with that product chosen', () => {
    expect(page).toMatch(/searchParams/);
    expect(page).toContain('inquiryTopic(');
    expect(page).toMatch(/initialProduct=/);
  });

  it('keeps only a known product and its own answers, through the same intake', () => {
    expect(actions).toContain('inquiryTopic(');
    expect(actions).toMatch(/businessType: topic\?\.label/);
    expect(actions).toMatch(/needs: topicNeeds\(topic, formData\)/);
  });

  it('hands back what was typed when the request is refused', () => {
    expect(actions).toMatch(/values: submittedValues\(formData\)/);
    expect(form).toMatch(/key=\{state\.attempt\}/);
  });
});

describe('the action calls the one domain function for this axis', () => {
  it('calls submitPublicInquiry, as a demo, rather than the ordinary customer-creation path', () => {
    // The intake shared with /contact — see lib/domain/public-intake/public-intake.ts.
    expect(actions).toContain('submitPublicInquiry');
    expect(actions).toMatch(/kind: 'demo'/);
    expect(actions).not.toContain('createCustomer');
  });
});
