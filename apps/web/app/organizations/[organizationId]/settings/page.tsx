import Link from 'next/link';
import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
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
      title: 'Communications',
      description: 'The phone numbers and email this business sends from.',
      href: `${root}/settings/communications`,
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
      <PageHeader title={areaLabel('settings')} description={`Durable configuration for ${organization.name}. Changes here apply to this business, not to your personal account.`} />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
        <Card as="section" className="border-accent">
          <SectionHeading>Setup</SectionHeading>
          <Hint className="mt-1">
            {organization.operationalState === 'setup'
              ? 'This business is still being set up. See what is finished and what blocks launch.'
              : 'This business is live. Review or reconfigure the areas setup covers.'}
          </Hint>
          <Link
            href={`${root}/setup`}
            className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
          >
            Open setup
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
