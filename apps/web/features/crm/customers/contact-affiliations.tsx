import Link from 'next/link';
import {Section,SectionHeading} from '@/components/surfaces/section';
import {listAffiliations} from '@/lib/domain/contacts/contacts';
import type {Contact} from '@/lib/domain/contacts/contacts';
import type {Db} from '@/lib/db/types';
import {AffiliationForm} from './contact-affiliation-form';
export async function ContactAffiliations({db,organizationId,contact,mayEdit}:{db:Db;organizationId:string;contact:Contact;mayEdit:boolean}) {
 if(!contact.contactType || contact.contactType==='unspecified') return <Section><SectionHeading>Needs classification</SectionHeading><p className="mt-2 text-sm text-muted">Edit this contact to classify it as a Person or Company before managing affiliations.</p></Section>;
 const isCompany=contact.contactType==='company';
 const [affiliations,options]=await Promise.all([listAffiliations(db,organizationId,contact.id),mayEdit?db.from('contacts').select('id,name').eq('organization_id',organizationId).eq('contact_type',isCompany?'person':'company').order('name').limit(500):Promise.resolve({data:[],error:null})]);
 if(options.error)throw options.error;
 return <Section><SectionHeading>{isCompany?'Associated people':'Company affiliations'}</SectionHeading>
 {affiliations.length?<ul className="mt-3 space-y-3">{affiliations.map(affiliation=>{const other=isCompany?affiliation.person:affiliation.company;return <li key={affiliation.id} className="space-y-2"><div><Link className="underline" href={`/organizations/${organizationId}/crm/contacts/${isCompany?affiliation.person_id:affiliation.company_id}`}>{other?.name ?? 'Contact'}</Link>{affiliation.title?` / ${affiliation.title}`:''}{affiliation.is_primary?' / Primary':''} / {affiliation.active?'Active':'Historical'}</div>{mayEdit?<AffiliationForm organizationId={organizationId} personId={affiliation.person_id} companyId={affiliation.company_id} title={affiliation.title ?? ''} active={affiliation.active} primary={affiliation.is_primary}/>:null}</li>;})}</ul>:<p className="mt-2 text-sm text-muted">{isCompany?'No associated people.':'No company affiliations.'}</p>}
 {mayEdit?<div className="mt-4"><h3 className="text-sm font-medium">{isCompany?'Associate an existing person':'Add a company affiliation'}</h3><AffiliationForm organizationId={organizationId} personId={isCompany?undefined:contact.id} companyId={isCompany?contact.id:undefined} options={options.data ?? []}/><Link className="mt-3 inline-block text-sm underline" href={`/organizations/${organizationId}/crm/contacts?create=1&type=${isCompany?'person':'company'}`}>{isCompany?'Add a person':'Add a company'}</Link></div>:null}
 </Section>;
}
