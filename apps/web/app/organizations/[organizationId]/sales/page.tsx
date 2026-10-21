import { CreateCustomerSheetProvider } from '@/features/crm/customers/create-customer-sheet';
import { CrmHome } from '@/features/crm/home/crm-home';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { availableFeatureKeys,organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listOpportunities,listOpportunityStages,summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { listFollowUps } from '@/lib/domain/follow-ups/follow-ups';
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
  const [states,customers,definitions,opportunitySummary,opportunityStages,members,stages,summary,opportunities,unassigned]=await Promise.all([
    organizationResolvedFeatureStates(db,{organizationId}),listCustomers(db,{organizationId,limit:5}),listFieldDefinitions(db,{organizationId,entityType:'customer'}),summarizeOpportunities(db,{organizationId}),listOpportunityStages(db,{organizationId}),listMembers(db,{organizationId}),listCustomerStages(db,{organizationId}),crmDashboardSummary(db,organizationId,month),listOpportunities(db,{organizationId,kind:'open',limit:5}),listOpportunities(db,{organizationId,kind:'open',ownerMembershipId:null,limit:5})]);
  const features=availableFeatureKeys(states); const followUpsEnabled=features.has('follow_ups'); const conversionEnabled=features.has('conversion_tracking');
  const [today,overdue,noNext]=await Promise.all([followUpsEnabled?listFollowUps(db,{organizationId,status:'open',...dueFilter('today',organization.timezone),limit:8}):[],followUpsEnabled?listFollowUps(db,{organizationId,status:'open',...dueFilter('overdue',organization.timezone),limit:5}):[],followUpsEnabled?listOpportunities(db,{organizationId,kind:'open',noNext:true,limit:5}):[]]);
  const contextEntries=await Promise.all(customers.map(async customer=>{
    const [touch,next]=await Promise.all([db.from('customer_activity').select('occurred_at').eq('organization_id',organizationId).eq('customer_id',customer.id).in('entity_type',['customer','opportunity','follow_up']).order('occurred_at',{ascending:false}).limit(1),followUpsEnabled?listFollowUps(db,{organizationId,customerId:customer.id,status:'open',limit:1}):[]]);
    if(touch.error)throw touch.error;
    return [customer.id,{stage:stages.find(s=>s.id===customer.stageId)?.name??'Unstaged',touch:touch.data?.[0]?.occurred_at??null,next:next[0]??null}] as const;
  }));
  const configureItems=await workspaceConfigureDoors(organizationId,'crm');
  const mayCreate=organization.capabilities.includes('customer.create');const mayConfigure=organization.capabilities.includes('field.manage');
  const home=<><CrmHome organizationId={organizationId} timezone={organization.timezone} month={month} summary={summary} customers={customers} customerContext={Object.fromEntries(contextEntries)} opportunitySummary={opportunitySummary} opportunities={opportunities} today={today} overdue={overdue} noNext={noNext} unassigned={unassigned} followUpsEnabled={followUpsEnabled} conversionEnabled={conversionEnabled}
    followUpOptions={{organizationId,timezone:organization.timezone,members,mayManage:followUpsEnabled && organization.capabilities.includes('follow_up.manage')}} opportunityOptions={{organizationId,stages:opportunityStages,members,defaultCurrency:organization.currency??''}} mayCreate={mayCreate} mayCreateOpportunity={organization.capabilities.includes('opportunity.create')} mayConfigure={mayConfigure} configureItems={configureItems}
    activity={<WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="crm" limit={6} emptyMessage="No CRM activity yet."/>}/>
  </>;
  return mayCreate?<CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions}>{home}</CreateCustomerSheetProvider>:home;
}
