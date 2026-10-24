import { ContactIntakeProvider } from '@/features/crm/intake/contact-intake';
import { anyIntake,contactIntakeOptions } from '@/lib/application/crm/contact-intake';
import { CrmHome } from '@/features/crm/home/crm-home';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { activeModuleKeys,availableFeatureKeys,organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listRecentRelationships,listRecentlyAddedContacts,relationshipOverview } from '@/lib/domain/contacts/relationship-activity';
import { listOpportunities,listOpportunityStages,summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { listTasks } from '@/lib/domain/tasks/tasks';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { todayInZone,zonedDayRange } from '@/lib/domain/scheduling/window';
import { crmDashboardSummary,salesComposition } from '@/lib/application/crm/dashboard';
import { requireOrganization } from '@/lib/route/organization';
import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
export const dynamic='force-dynamic';
export default async function CrmDashboardPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{month?:string;group?:string}>}) {
  const {organizationId}=await params; const q=await searchParams; const {db,organization}=await requireOrganization(organizationId);
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month??'')?`${q.month}-01`:`${todayInZone(organization.timezone).slice(0,7)}-01`;
  const grouped=q.group==='company'; const has=(capability:(typeof organization.capabilities)[number])=>organization.capabilities.includes(capability);
  const [states,overview,definitions,members,opportunitySummary,configureItems]=await Promise.all([
    organizationResolvedFeatureStates(db,{organizationId}),relationshipOverview(db,organizationId),listFieldDefinitions(db,{organizationId,entityType:'customer'}),listMembers(db,{organizationId}),summarizeOpportunities(db,{organizationId}),workspaceConfigureDoors(organizationId,'crm')]);
  const features=availableFeatureKeys(states); const followUpsEnabled=features.has('follow_ups'); const conversionEnabled=features.has('conversion_tracking');
  const mayConfigure=has('field.manage');
  // Entitlement, permission and data state are separate inputs; see `salesComposition`.
  const composition=salesComposition({entitled:true,hasStages:opportunitySummary.some(s=>s.stageId),hasOpportunities:opportunitySummary.some(s=>s.count>0),mayConfigureStages:mayConfigure});
  const salesEnabled=composition==='full'; const now=new Date(); const day=zonedDayRange(todayInZone(organization.timezone,now),organization.timezone);
  const [active,summary,opportunityStages,unassigned,noNext,overdue,today]=await Promise.all([
    listRecentRelationships(db,{organizationId,includeNextTask:followUpsEnabled}),
    salesEnabled?crmDashboardSummary(db,organizationId,month):null,
    salesEnabled?listOpportunityStages(db,{organizationId}):[],
    salesEnabled?listOpportunities(db,{organizationId,kind:'open',ownerMembershipId:null,limit:5}):[],
    salesEnabled&&followUpsEnabled?listOpportunities(db,{organizationId,kind:'open',noNext:true,limit:5}):[],
    followUpsEnabled?listTasks(db,{organizationId,status:'open',before:now.toISOString(),limit:5}):null,
    // Due later today only: anything already past due is Overdue, so no task is listed twice.
    followUpsEnabled?listTasks(db,{organizationId,status:'open',from:new Date(Math.max(now.getTime(),Date.parse(day.startsAt))).toISOString(),before:day.endsAt,limit:8}):null]);
  const relationships=active.length||!overview.total?{rows:active,mode:'active' as const,grouped}:{rows:await listRecentlyAddedContacts(db,{organizationId}),mode:'added' as const,grouped};
  // One intake dialog offers create, import and synchronize, each by the capability its destination enforces.
  const intake=await contactIntakeOptions(db,{organizationId,capabilities:organization.capabilities,modules:activeModuleKeys(states)}); const mayAddContacts=anyIntake(intake);
  const home=<><CrmHome organizationId={organizationId} timezone={organization.timezone} month={month} overview={overview} relationships={relationships}
    sales={summary?{summary,stages:opportunitySummary}:null} salesComposition={composition}
    attention={{overdue:overdue?.total??0,today:today?.total??0,noNext:summary?.noNext??0,unassigned:summary?.unassigned??0}} today={today??[]} overdue={overdue??[]} noNext={noNext} unassigned={unassigned}
    followUpsEnabled={followUpsEnabled} conversionEnabled={conversionEnabled}
    followUpOptions={{organizationId,timezone:organization.timezone,members,mayManage:followUpsEnabled&&has('follow_up.manage')}} opportunityOptions={{organizationId,stages:opportunityStages,members,defaultCurrency:organization.currency??''}} mayAddContacts={mayAddContacts} mayCreateOpportunity={has('opportunity.create')} mayConfigure={mayConfigure} configureItems={configureItems}/>
    <SupportRegistrar mode="activity" title="CRM activity"><WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="crm" limit={20} emptyMessage="No CRM activity yet."/></SupportRegistrar>
  </>;
  return mayAddContacts?<ContactIntakeProvider organizationId={organizationId} definitions={definitions} options={intake}>{home}</ContactIntakeProvider>:home;
}
