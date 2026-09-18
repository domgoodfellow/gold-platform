import Link from 'next/link';
import { Card } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Settings is an organization hub, not a second navigation rail. */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const { organization } = await requireOrganization(organizationId);
  const root = `/organizations/${organizationId}`;
  const destinations = [
    {
      title: 'General',
      description: 'Business name, public slug, timezone, currency, and scheduling buffer.',
      href: `${root}/settings/general`,
    },
    {
      title: 'Branding & public presence',
      description: 'Logo, colors, and the way this business introduces itself publicly.',
      href: `${root}/settings/branding`,
    },
    {
      title: 'Website',
      description: 'Homepage publishing and the public communication profile.',
      href: `${root}/settings/website`,
    },
    {
      title: 'Connections',
      description: 'Provider connections used by this business.',
      href: `${root}/settings/connections`,
    },
    {
      title: 'Features',
      description: 'Enabled GOLD capabilities for this organization.',
      href: `${root}/settings/features`,
    },
    {
      title: 'Plan & usage',
      description: 'Current plan, feature entitlements, usage, and commercial status.',
      href: `${root}/settings/plan`,
    },
  ];

  return (
    <SettingsPageFrame>
      <Hint className="mt-1">Durable configuration for how this business runs.</Hint>

      <div className="mt-6 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
        <Card as="section" className="border-accent">
          <SectionHeading>Guided setup</SectionHeading>
          <Hint className="mt-1">
            {organization.operationalState === 'setup'
              ? 'Readiness checks and launch controls for this business.'
              : 'Review the setup path this business launched through.'}
          </Hint>
          <Link
            href={`${root}/setup`}
            className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
          >
            Open guided setup
          </Link>
        </Card>

        {destinations.map((destination) => (
          <Card key={destination.href} as="section">
            <SectionHeading>{destination.title}</SectionHeading>
            <Hint className="mt-1">{destination.description}</Hint>
            <Link
              href={destination.href}
              className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
            >
              Open
            </Link>
          </Card>
        ))}
      </div>
    </SettingsPageFrame>
  );
}
