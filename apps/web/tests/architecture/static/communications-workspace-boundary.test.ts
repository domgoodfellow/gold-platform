import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AREAS } from '@/lib/navigation';

/**
 * Communications owns channels and conversation history (Calls, the Inbox, Numbers); Platform
 * Infrastructure owns the carrier account, credentials and subaccounts behind them (D39, I15).
 * What proves the boundary is the one thing a business's own screens must never say.
 */

const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTES = `${WEB_ROOT}/app/organizations/[organizationId]`;

const TENANT_COMMS_SOURCE = [
  'comms/page.tsx',
  'comms/inbox/page.tsx',
  'comms/inbox/[conversationId]/page.tsx',
  'comms/inbox/new/page.tsx',
  'comms/configuration/numbers/page.tsx',
  'comms/configuration/numbers/[phoneNumberId]/page.tsx',
  'calls/page.tsx',
].map((route) => readFileSync(`${ROUTES}/${route}`, 'utf8'));

const PROVIDER_VOCABULARY = /twilio|account[_ ]?sid|auth[_ ]?token|twiml/i;

describe('Communications workspace boundaries', () => {
  it('registers Calls, the Inbox and Numbers as sibling pages of the Communications workspace', () => {
    const pages = AREAS.filter((area) => area.workspace === 'communications').map((area) => area.segment);
    expect(pages).toEqual(['comms', 'calls', 'comms-inbox', 'comms-numbers']);
  });

  it('names no provider in a tenant-facing Communications route', () => {
    for (const source of TENANT_COMMS_SOURCE) {
      expect(source).not.toMatch(PROVIDER_VOCABULARY);
    }
  });

  it('renders no provider vocabulary from the number inventory a tenant screen reads', () => {
    // `lib/domain/reception/telephony.ts` names "auth token" once, in its own doc comment
    // explaining the D39 refusal — legitimate architectural commentary, not a leak. What must
    // stay clean is what the row actually carries: `PhoneNumber` names no vendor field, and the
    // component that renders it names no vendor either.
    const numbers = readFileSync(`${WEB_ROOT}/lib/domain/reception/numbers.ts`, 'utf8');
    const numberList = readFileSync(`${WEB_ROOT}/features/communications/numbers/number-list.tsx`, 'utf8');
    for (const source of [numbers, numberList]) {
      expect(source).not.toMatch(PROVIDER_VOCABULARY);
    }
  });
});
