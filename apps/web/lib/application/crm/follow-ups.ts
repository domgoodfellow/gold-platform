import type { Db } from '@/lib/db/types';
import { listFollowUps, type FollowUpFilter } from '@/lib/domain/follow-ups/follow-ups';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
export async function followUpsAvailable(db: Db, organizationId: string): Promise<boolean> {
  return availableFeatureKeys(await organizationResolvedFeatureStates(db,{organizationId})).has('follow_ups');
}
export function dueFilter(due:string,timezone:string,now:Date=new Date()):Pick<FollowUpFilter,'from'|'before'> {
  const today=zonedDayRange(todayInZone(timezone,now),timezone);
  if(due==='overdue')return {before:now.toISOString()};
  if(due==='today')return {from:today.startsAt,before:today.endsAt};
  if(due==='upcoming')return {from:now.toISOString()};
  return {};
}
export async function relatedFollowUps(db:Db,organizationId:string,customerId:string,opportunityId?:string) {
  const filter={organizationId,customerId,opportunityId,limit:20};
  const now=new Date().toISOString();
  const [overdue,upcoming,recent]=await Promise.all([listFollowUps(db,{...filter,status:'open',before:now}),listFollowUps(db,{...filter,status:'open',from:now}),listFollowUps(db,{...filter,status:'completed',recent:true})]);
  return {open:[...overdue,...upcoming],recent,now};
}
