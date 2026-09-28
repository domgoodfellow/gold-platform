import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
/**
 * Who this identity belongs to, not who dialled it (D39, restated for the number itself).
 * `provisioned`: GOLD created it at the carrier and holds the provider resource behind it.
 * `external`: a number this business already owned, taken as an outbound identity where the
 * carrier's own rules permit — GOLD never created a resource for it and controls no inbound
 * routing on it. `browser`: an internal calling endpoint, never presented as a public number.
 * `sip`: reserved vocabulary — no writer exists yet in this codebase (no BYOC in this slice).
 */
export type PhoneNumberOrigin='provisioned'|'external'|'browser'|'sip';
export type PhoneNumber={id:string;e164:string;label:string|null;lifecycle:'active'|'inactive'|'quarantined';purpose:string;inboundEnabled:boolean;outboundEnabled:boolean;health:string;providerResourceId:string|null;origin:PhoneNumberOrigin;createdBy:string|null};
const NUMBER_COLUMNS='id,e164,label,lifecycle,purpose,inbound_enabled,outbound_enabled,health,provider_resource_id,origin,created_by';
type NumberRow={id:string;e164:string;label:string|null;lifecycle:string;purpose:string;inbound_enabled:boolean;outbound_enabled:boolean;health:string;provider_resource_id:string|null;origin:string;created_by:string|null};
function toPhoneNumber(r:NumberRow):PhoneNumber{return{id:r.id,e164:r.e164,label:r.label,lifecycle:r.lifecycle as PhoneNumber['lifecycle'],purpose:r.purpose,inboundEnabled:r.inbound_enabled,outboundEnabled:r.outbound_enabled,health:r.health,providerResourceId:r.provider_resource_id,origin:r.origin as PhoneNumberOrigin,createdBy:r.created_by};}
export async function listPhoneNumbers(db:Db,input:{organizationId:string}):Promise<PhoneNumber[]>{const {data,error}=await db.from('phone_numbers').select(NUMBER_COLUMNS).eq('organization_id',input.organizationId).order('e164');if(error)throw new DomainError(error.message,'numbers.list_failed');return(data??[]).map(toPhoneNumber);}
/** One number, or null if it does not exist in this organization — the RLS policy already refuses another business's row; this is the honest absence, not a thrown error. */
export async function getPhoneNumber(db:Db,input:{organizationId:string;phoneNumberId:string}):Promise<PhoneNumber|null>{const {data,error}=await db.from('phone_numbers').select(NUMBER_COLUMNS).eq('organization_id',input.organizationId).eq('id',input.phoneNumberId).maybeSingle();if(error)throw new DomainError(error.message,'numbers.read_failed');return data?toPhoneNumber(data):null;}
export async function assignPhoneNumber(db:Db,input:{organizationId:string;phoneNumberId:string;memberId?:string;resourceId?:string;isDefault?:boolean}){const {data,error}=await db.rpc('assign_phone_number',{p_organization_id:input.organizationId,p_phone_number_id:input.phoneNumberId,p_member_id:input.memberId,p_resource_id:input.resourceId,p_default:input.isDefault??false});if(error)throw new DomainError(error.message,'numbers.assign_failed');return data as string;}
// This slice deliberately has no separate user-preference row. An active default member
// assignment is the sole user-specific choice; organization telephony settings remain the
// deterministic fallback until a preference needs a distinct caller and write path.
export async function effectiveOutboundNumber(db:Db,input:{organizationId:string}):Promise<string|null>{const {data,error}=await db.rpc('resolve_effective_outbound_identity',{p_organization_id:input.organizationId});if(error)throw new DomainError(error.message,'numbers.resolve_failed');return data as string|null;}
export type PhoneNumberAssignment={id:string;phoneNumberId:string;memberId:string|null;resourceId:string|null;isDefault:boolean};
/** Active assignments only — a released one is history, not a current fact about who dials from where. */
export async function listPhoneNumberAssignments(db:Db,input:{organizationId:string}):Promise<PhoneNumberAssignment[]>{const {data,error}=await db.from('phone_number_assignments').select('id,phone_number_id,member_id,resource_id,is_default').eq('organization_id',input.organizationId).is('released_at',null);if(error)throw new DomainError(error.message,'numbers.assignments_failed');return(data??[]).map(r=>({id:r.id,phoneNumberId:r.phone_number_id,memberId:r.member_id,resourceId:r.resource_id,isDefault:r.is_default}));}
