import { PageHeader } from '@/components/headers/page-header';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { StageSettingsSheet } from '@/features/crm/sales/stage-settings-sheet';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

export const dynamic = 'force-dynamic';

/**
 * CRM's own configuration door for the stages a relationship moves through — split out of the
 * former combined "Calls and sales stages" Settings entry, which pointed at Communications and
 * never actually touched stages at all. Reuses `StageSettingsSheet`, the same editor the Pipeline
 * board's own header and the Customers Configure rail already open; this page adds no second one.
 */
export default async function SalesStagesSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/sales-stages'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const stages = await listCustomerStages(db, { organizationId });
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Relationship stages"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
        ]}
        actions={<StageSettingsSheet organizationId={organizationId} stages={stages} mayConfigure={mayConfigure} role={organization.role} />}
      />
      <Hint>The stages a relationship moves through, in order.</Hint>
      {stages.length === 0 ? (
        <EmptyState className="mt-4">No stages named.</EmptyState>
      ) : (
        <Section className="mt-6">
          <SectionHeading>Stages</SectionHeading>
          <DividedList as="div" className="mt-2">
            {stages.map((stage) => (
              <div key={stage.id} className="py-2 text-sm">{stage.name}</div>
            ))}
          </DividedList>
        </Section>
      )}
    </SettingsPageFrame>
  );
}
