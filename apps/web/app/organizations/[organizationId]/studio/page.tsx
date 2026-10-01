import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { DividedList, EmptyState, SectionHeading } from '@/components/surfaces/section';
import { ButtonLink } from '@/components/controls/button';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { studioOverview } from '@/lib/application/studio/studio-overview';
import { workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

const WEBSITE_STATE_LABEL: Record<string, string> = {
  not_configured: 'Not configured',
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
};

/**
 * Studio Home: what is currently public for this business, and what needs attention. An
 * operational overview, not a configuration form — every card links to the existing surface that
 * actually owns the setting (Website and Brand stay in Settings, Booking's configuration stays
 * Field's, D68).
 */
export default async function StudioPage({ params }: PageProps<'/organizations/[organizationId]/studio'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManageWebsite = organization.capabilities.includes('organization.manage');

  const overview = await studioOverview(db, {
    organizationId,
    slug: organization.slug,
    organizationName: organization.name,
    mayManageWebsite,
  });

  const websitePath = `/organizations/${organizationId}/studio/website`;
  const brandPath = `/organizations/${organizationId}/settings/branding`;
  const bookingConfigPath = `/organizations/${organizationId}/work/configuration`;
  const customersPath = `/organizations/${organizationId}/customers`;

  const websiteValue = overview.website ? WEBSITE_STATE_LABEL[overview.website.state] : '—';
  const websiteNote = overview.website
    ? overview.website.revisionNumber === null
      ? 'No revision yet'
      : `Revision ${overview.website.revisionNumber}${overview.website.publishedAt ? ` · published ${new Date(overview.website.publishedAt).toLocaleDateString()}` : ''}`
    : `Your role, ${organization.role}, cannot view website status.`;

  const bookingValue = overview.booking.bookableTypeCount > 0 ? 'Available' : 'Needs configuration';
  const bookingNote =
    overview.booking.bookableTypeCount > 0
      ? `${overview.booking.bookableTypeCount} bookable type${overview.booking.bookableTypeCount === 1 ? '' : 's'}`
      : 'No bookable type exists yet';

  const portalValue = overview.portal.activeInviteCount > 0 ? 'In use' : 'Not yet used';
  const portalNote =
    overview.portal.activeInviteCount > 0
      ? `${overview.portal.activeInviteCount} customer${overview.portal.activeInviteCount === 1 ? '' : 's'} currently invited`
      : 'Invite a customer to the portal from their own page';

  const brandValue = overview.brand.logoConfigured ? 'Configured' : 'Missing logo';
  const brandNote = overview.brand.accentConfigured ? 'Custom colour set' : 'Using the platform look';

  return (
    <WorkspaceHome
      title={workspaceLabel('studio')}
      actions={
        <>
          <ButtonLink tone="primary" href={websitePath}>Edit website</ButtonLink>
          {overview.publicUrl ? (
            <ButtonLink tone="secondary" href={overview.publicUrl} target="_blank" rel="noreferrer">View site</ButtonLink>
          ) : null}
        </>
      }
    >
      <SectionHeading>Public surfaces</SectionHeading>
      <WidgetGrid className="mt-3">
        <Widget title="Website" value={websiteValue} note={websiteNote} href={websitePath} />
        <Widget title="Booking" value={bookingValue} note={bookingNote} href={bookingConfigPath} />
        <Widget title="Portal" value={portalValue} note={portalNote} href={customersPath} />
        <Widget title="Brand" value={brandValue} note={brandNote} href={brandPath} />
      </WidgetGrid>

      <section className="mt-10">
        <SectionHeading>Needs attention</SectionHeading>
        {overview.attention.length === 0 ? (
          <EmptyState className="mt-3">Nothing needs attention.</EmptyState>
        ) : (
          <DividedList className="mt-3 text-sm">
            {overview.attention.map((item) => (
              <li key={item.key} className="py-2">{item.label}</li>
            ))}
          </DividedList>
        )}
      </section>

      {overview.recentPublishing.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>Recent publishing</SectionHeading>
          <DividedList className="mt-3 text-sm">
            {overview.recentPublishing.map((revision) => (
              <li key={revision.id} className="flex justify-between gap-4 py-2">
                <span>Revision {revision.number}</span>
                <span className="text-muted">{revision.status.replace('_', ' ')}</span>
              </li>
            ))}
          </DividedList>
        </section>
      ) : null}
    </WorkspaceHome>
  );
}
