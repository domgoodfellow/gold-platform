import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The `/demo` route's own words, by source scan — the same convention every other
 * marketing/navigation suite here uses, for the same reason: no harness in this repository mounts
 * a server component.
 */

const ROUTE = fileURLToPath(new URL('../app/(marketing)/demo', import.meta.url));
const page = readFileSync(`${ROUTE}/page.tsx`, 'utf8');
const form = readFileSync(`${ROUTE}/demo-form.tsx`, 'utf8');
const actions = readFileSync(`${ROUTE}/actions.ts`, 'utf8');
const access = readFileSync(
  fileURLToPath(new URL('../lib/route/access.ts', import.meta.url)),
  'utf8',
);

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

  it('uses customer-facing demo language, not internal "workflow review" wording', () => {
    expect(page + form).not.toMatch(/workflow review/i);
    expect(form).toContain('Request a demo');
  });
});

describe('the success experience', () => {
  it('thanks the visitor and mentions a demo, rather than "workflow review submitted"', () => {
    expect(form).toMatch(/we.{0,10}ll review what you shared and contact you about a demo/i);
    // The success branch itself must not push the visitor toward account creation.
    const successBranch = form.slice(form.indexOf('state.done'), form.indexOf('return (\n    <form'));
    expect(successBranch).not.toContain('/sign-up');
  });

  it('makes no response-time promise', () => {
    expect(form).not.toMatch(/\b\d+\s*(hours?|minutes?|days?|business days?)\b/i);
  });

  it('offers a way back home and a way to log in, and keeps self-serve quiet and optional', () => {
    const successBranch = form.slice(form.indexOf('state.done'), form.indexOf('return (\n    <form'));
    expect(successBranch).toMatch(/href="\/"/);
    expect(successBranch).toMatch(/href="\/login"/);
  });
});

describe('the action calls the one domain function for this axis', () => {
  it('calls requestWorkflowReview rather than the ordinary customer-creation path', () => {
    // The reused domain function's internal name — see lib/domain/workflow-review/workflow-review.ts.
    // Renaming it would mean a second RPC/migration doing exactly what this one already does.
    expect(actions).toContain('requestWorkflowReview');
    expect(actions).not.toContain('createCustomer');
  });
});
