import { notFound } from 'next/navigation';
import CallsPage from '@/app/organizations/[organizationId]/calls/page';
import { DialerPopoutProvider } from '@/features/communications/voice/dialer-popout';
import { OrganizationShell } from '@/features/shell/organization-shell';
import { TestTelephone, type TestTelephoneState } from './test-telephone';

const STATES: TestTelephoneState[] = ['connected', 'ringing', 'incoming', 'ended'];

/**
 * Development fixture: the real organization shell and the real Dialer page for a business the
 * signed-in person belongs to, with a test telephone holding one call in place of the carrier
 * device. `state` chooses the point in the call's life (`connected` by default, or `ringing`,
 * `incoming`, `ended`); `customer` is the contact the call is attributed to. Authorization is
 * unchanged — every read runs as the viewer — and nothing here can dial.
 * Used by `e2e/dialer-console.spec.ts` for live-call rendered evidence.
 */
export default async function DialerFixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { organizationId, callId, contact, customer, state } = await searchParams;
  if (typeof organizationId !== 'string' || typeof callId !== 'string') notFound();
  return (
    <TestTelephone
      callId={callId}
      contactLabel={typeof contact === 'string' ? contact : 'Test caller'}
      customerId={typeof customer === 'string' ? customer : null}
      state={STATES.find((known) => known === state) ?? 'connected'}
    >
      <DialerPopoutProvider organizationId={organizationId}>
        <OrganizationShell organizationId={organizationId}>
          <CallsPage params={Promise.resolve({ organizationId })} searchParams={Promise.resolve({})} />
        </OrganizationShell>
      </DialerPopoutProvider>
    </TestTelephone>
  );
}
