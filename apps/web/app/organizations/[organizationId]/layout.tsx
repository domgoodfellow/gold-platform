import { ActiveCallDock } from '@/features/communications/voice/active-call-dock';
import { TelephoneDeviceProvider } from '@/features/communications/voice/telephone-device';
import { DialerPopoutProvider } from '@/features/communications/voice/dialer-popout';
import { OrganizationShell } from '@/features/shell/organization-shell';

/**
 * The operator shell for one business. Every organization page renders inside `OrganizationShell`,
 * Platform Administration (`platform/`, beneath GOLD's own organization) included; see it for what
 * the shell projects and why it is not the authorization boundary.
 *
 * **The telephone device lives above the shell, not inside a workspace page.** A live call is
 * this organization's fact, not one page's — an operator who navigates away to look up a record
 * mid-call must not be hung up on by the router. `ActiveCallDock` renders nothing until a call is
 * actually live, so a business with no calling capability sees no trace of either.
 */
export default async function OrganizationLayout({
  params,
  children,
}: LayoutProps<'/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  return (
    <TelephoneDeviceProvider organizationId={organizationId}>
      <DialerPopoutProvider key={organizationId} organizationId={organizationId}>
        <OrganizationShell organizationId={organizationId} feedback={<ActiveCallDock organizationId={organizationId} />}>{children}</OrganizationShell>
      </DialerPopoutProvider>
    </TelephoneDeviceProvider>
  );
}
