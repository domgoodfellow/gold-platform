import Link from 'next/link';
import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { Card } from '@/components/containers/card';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { FOCUS_RING } from '@/components/class-names';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Settings is an organization hub, not a second navigation rail.
 *
 * Setup is the business's lifecycle, not one more durable-settings destination, so it stands above
 * the grid on its own. Each destination below is one link — its title — stretched over its card:
 * one obvious target, no row of identical "Open"s, and no other control inside a card that is
 * clickable as a whole.
 */
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
      <PageHeader
        title={areaLabel('settings')}
        description={`Durable configuration for ${organization.name}. Changes here apply to this business, not to your personal account.`}
      />

      <Card as="section" className="mb-4 border-accent">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <SectionHeading>Setup</SectionHeading>
            <Hint className="mt-1">
              {organization.operationalState === 'setup'
                ? 'This business is still being set up. See what is finished and what blocks launch.'
                : 'This business is live. Review or reconfigure the areas setup covers.'}
            </Hint>
          </div>
          <ButtonLink href={`${root}/setup`} tone="secondary">
            Open setup
          </ButtonLink>
        </div>
      </Card>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
        {destinations.map((destination) => (
          <Card
            key={destination.href}
            as="section"
            className="relative transition-colors hover:bg-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent-text"
          >
            <SectionHeading>
              <Link href={destination.href} className={`${FOCUS_RING} rounded after:absolute after:inset-0`}>
                {destination.title}
              </Link>
            </SectionHeading>
            <Hint className="mt-1">{destination.description}</Hint>
          </Card>
        ))}
      </div>
    </SettingsPageFrame>
  );
}
