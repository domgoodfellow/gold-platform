import { CreateCustomerSheetProvider } from '@/features/crm/customers/create-customer-sheet';
import { CrmHome } from '@/features/crm/home/crm-home';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { availableFeatureKeys,organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listContacts, listContactLastActivity } from '@/lib/domain/contacts/contacts';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listOpportunities,listOpportunityStages,summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { listTasks } from '@/lib/domain/tasks/tasks';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { dueFilter } from '@/lib/application/crm/follow-ups';
import { crmDashboardSummary } from '@/lib/application/crm/dashboard';
import { requireOrganization } from '@/lib/route/organization';
import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
export const dynamic='force-dynamic';
export default async function SalesPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{month?:string}>}) {
  const {organizationId}=await params; const q=await searchParams; const {db,organization}=await requireOrganization(organizationId);
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month??'')?`${q.month}-01`:`${todayInZone(organization.timezone).slice(0,7)}-01`;
  const [states,customers,definitions,opportunitySummary,opportunityStages,members,stages,summary,unassigned]=await Promise.all([
    organizationResolvedFeatureStates(db,{organizationId}),listContacts(db,{organizationId,limit:5}),listFieldDefinitions(db,{organizationId,entityType:'customer'}),summarizeOpportunities(db,{organizationId}),listOpportunityStages(db,{organizationId}),listMembers(db,{organizationId}),listCustomerStages(db,{organizationId}),crmDashboardSummary(db,organizationId,month),listOpportunities(db,{organizationId,kind:'open',ownerMembershipId:null,limit:5})]);
  const features=availableFeatureKeys(states); const followUpsEnabled=features.has('follow_ups'); const conversionEnabled=features.has('conversion_tracking');
  const [today,overdue,noNext]=await Promise.all([followUpsEnabled?listTasks(db,{organizationId,status:'open',...dueFilter('today',organization.timezone),limit:8}):[],followUpsEnabled?listTasks(db,{organizationId,status:'open',...dueFilter('overdue',organization.timezone),limit:5}):[],followUpsEnabled?listOpportunities(db,{organizationId,kind:'open',noNext:true,limit:5}):[]]);
  const [lastActivity,nextEntries]=await Promise.all([
    listContactLastActivity(db,{organizationId,customerIds:customers.map(customer=>customer.id)}),
    Promise.all(customers.map(customer=>followUpsEnabled?listTasks(db,{organizationId,customerId:customer.id,status:'open',limit:1}):Promise.resolve([])))
  ]);
  const contextEntries=customers.map((customer,index)=>[customer.id,{stage:stages.find(stage=>stage.id===customer.stageId)?.name??'Unstaged',touch:lastActivity[customer.id]??null,next:nextEntries[index][0]??null}] as const);
  const configureItems=await workspaceConfigureDoors(organizationId,'crm');
  const mayCreate=organization.capabilities.includes('customer.create');const mayConfigure=organization.capabilities.includes('field.manage');
  const home=<><CrmHome organizationId={organizationId} timezone={organization.timezone} month={month} summary={summary} customers={customers} customerContext={Object.fromEntries(contextEntries)} opportunitySummary={opportunitySummary} today={today} overdue={overdue} noNext={noNext} unassigned={unassigned} followUpsEnabled={followUpsEnabled} conversionEnabled={conversionEnabled}
    followUpOptions={{organizationId,timezone:organization.timezone,members,mayManage:followUpsEnabled && organization.capabilities.includes('follow_up.manage')}} opportunityOptions={{organizationId,stages:opportunityStages,members,defaultCurrency:organization.currency??''}} mayCreate={mayCreate} mayCreateOpportunity={organization.capabilities.includes('opportunity.create')} mayConfigure={mayConfigure} configureItems={configureItems}
/>
    <SupportRegistrar mode="activity" title="CRM activity"><WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="crm" limit={20} emptyMessage="No CRM activity yet."/></SupportRegistrar>
  </>;
  return mayCreate?<CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions}>{home}</CreateCustomerSheetProvider>:home;
}
