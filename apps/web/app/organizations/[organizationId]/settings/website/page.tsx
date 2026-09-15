import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import { HomepageEditor } from '@/features/public-site/homepage-editor';
import { CommunicationProfileForm } from './communication-profile-form';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { homepageEditorState } from '@/lib/domain/public-site/public-site';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function WebsiteSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/website'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const state = mayManage ? await homepageEditorState(db, organizationId) : null;
  const profile = state ? await (db.rpc.bind(db) as unknown as (name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>)('public_communication_profile', { p_site_id: state.siteId }) : null;
  const profileValue = profile?.data as { displayName?:string; greeting?:string; instructions?:string; handoffMessage?:string } | null;

  return <SettingsPageFrame organizationId={organizationId}>
    <PageHeading>Website</PageHeading>
    <Hint className="mt-1">Edit a private draft, review the exact rendered page, then publish deliberately. Profile and brand remain in Public presence.</Hint>
    {mayManage && state ? <>
      <HomepageEditor organizationId={organizationId} working={state?.working ?? null} published={state?.published ?? null} />
      <CommunicationProfileForm organizationId={organizationId} siteId={state.siteId} initial={{enabled:Boolean(profileValue),displayName:profileValue?.displayName??'Assistant',greeting:profileValue?.greeting??'Hi — how can I help?',instructions:profileValue?.instructions??'',handoffMessage:profileValue?.handoffMessage??'Thanks — a member of our team will follow up.',handoffDestination:''}} />
      {state?.history.length ? <section className="mt-8 border-t border-border pt-5"><h2 className="font-semibold">Revision history</h2><ol className="mt-3 divide-y divide-border border-y border-border">{state.history.map((revision) => <li key={revision.id} className="flex justify-between gap-4 py-3 text-sm"><span>Revision {revision.number}</span><span className="text-muted">{revision.status.replace('_', ' ')}</span></li>)}</ol></section> : null}
    </> : <Hint className="mt-5">{mayManage ? 'No website is configured for this organization on the platform domain.' : `Your role, ${organization.role}, cannot edit or preview this website.`}</Hint>}
  </SettingsPageFrame>;
}
