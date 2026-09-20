import { PageHeader } from '@/components/containers/page-header';
import { Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';
import { PERSONAL_SETTINGS_ROOT } from '@/lib/route/personal-settings';

export const dynamic = 'force-dynamic';

/** Personal settings → Profile. The person's identity, which no business owns (D45). */
export default async function ProfilePage({ searchParams }: PageProps<'/settings/account'>) {
  const { org } = await searchParams;

  return (
    <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
      {({ email }) => (
        <>
          <PageHeader
            title="Profile"
            crumbs={[{ label: 'Personal settings', href: PERSONAL_SETTINGS_ROOT }]}
            description="Your identity. It belongs to you, not to any business, and applies in every business you belong to."
          />
          <Section>
            <SectionHeading>Email</SectionHeading>
            <Hint className="mt-2">{email}</Hint>
          </Section>
        </>
      )}
    </PersonalSettingsShell>
  );
}
