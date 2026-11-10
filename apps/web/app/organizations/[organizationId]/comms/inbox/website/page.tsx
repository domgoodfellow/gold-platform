import { requireOrganization } from '@/lib/route/organization';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { websiteConversations } from '@/lib/domain/reception/website-conversations';
import { WebsiteConversationView } from '@/features/communications/inbox/website-conversations';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function WebsiteInbox({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{thread?:string}>}){
 const {organizationId}=await params,{thread}=await searchParams;
 if(!thread)redirect(`/organizations/${organizationId}/comms/inbox?channel=web`);
 const {db,organization}=await requireOrganization(organizationId),actor=await requireActor(db);
 const data=await websiteConversations(db,organizationId,thread);
 return <WebsiteConversationView organizationId={organizationId} data={data} canReply={organization.capabilities.includes('message.send')} userId={actor.id} embedded/>;
}
