import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Settings' own landing page — a hub, not a settings destination in its own right. Business
 * identity/regional settings, branding and public presence, opening hours, custom fields, people
 * and roles, automations, pricing, payments, modules and plan & usage all have their own place
 * under the Settings navigation now; see `features/settings/settings-navigation.tsx`.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const { organization } = await requireOrganization(organizationId);

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <Hint className="mt-1">Durable configuration for how this business runs.</Hint>

      <Section className="mt-6">
        <SectionHeading>Business setup</SectionHeading>
        <Hint className="mt-1">
          {organization.operationalState === 'setup'
            ? 'Describe this business, review readiness, and launch when ready.'
            : "Review or revise this business's configuration."}
        </Hint>
        <Link
          href={`/organizations/${organizationId}/setup`}
          className="mt-2 inline-block text-sm underline underline-offset-4"
        >
          Guided setup
        </Link>
      </Section>
    </SettingsPageFrame>
  );
}
