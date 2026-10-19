import { notFound } from 'next/navigation';
import CallsPage from '@/app/organizations/[organizationId]/calls/page';
import { DialerPopoutProvider } from '@/features/communications/voice/dialer-popout';
import { OrganizationShell } from '@/features/shell/organization-shell';
import { TestTelephone } from './test-telephone';

/**
 * Development fixture: the real organization shell and the real Dialer page for a business the
 * signed-in person belongs to, with a test telephone holding one live call in place of the carrier
 * device. Authorization is unchanged — every read runs as the viewer — and nothing here can dial.
 * Used by `e2e/dialer-console.spec.ts` for live-call rendered evidence.
 */
export default async function DialerFixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { organizationId, callId, contact } = await searchParams;
  if (typeof organizationId !== 'string' || typeof callId !== 'string') notFound();
  return (
    <TestTelephone callId={callId} contactLabel={typeof contact === 'string' ? contact : 'Test caller'}>
      <DialerPopoutProvider organizationId={organizationId}>
        <OrganizationShell organizationId={organizationId}>
          <CallsPage params={Promise.resolve({ organizationId })} searchParams={Promise.resolve({})} />
        </OrganizationShell>
      </DialerPopoutProvider>
    </TestTelephone>
  );
}
