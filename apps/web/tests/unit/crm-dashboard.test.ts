import { describe,expect,it } from 'vitest';
import { groupRelationshipsByCompany,relationshipActivityLabel,salesComposition } from '@/lib/application/crm/dashboard';
import type { RelationshipRow } from '@/lib/domain/contacts/relationship-activity';
const row=(id:string,contactType:RelationshipRow['contactType'],companyId:string|null=null,companyName:string|null=null):RelationshipRow=>({id,name:id,contactType,lifecycle:null,companyId,companyName,activity:null,nextTask:null});
describe('CRM dashboard composition rules',()=>{
  it('groups people under their one primary company, company rows head their group, and unaffiliated people stay discoverable',()=>{
    const groups=groupRelationshipsByCompany([row('ada','person','acme','Acme'),row('solo','person'),row('globex','company'),row('acme','company'),row('ben','person','acme','Acme'),row('cy','person','initech','Initech'),row('legacy','unspecified')]);
    expect(groups.map(g=>[g.companyName,g.company?.id??null,g.people.map(p=>p.id)])).toEqual([
      ['acme','acme',['ada','ben']],['globex','globex',[]],['Initech',null,['cy']],[null,null,['solo','legacy']]]);
    const people=groups.flatMap(g=>g.people.map(p=>p.id));expect(new Set(people).size).toBe(people.length);
  });
  it('evaluates entitlement, data state and permission separately for the sales section',()=>{
    expect(salesComposition({entitled:false,hasStages:true,hasOpportunities:true,mayConfigureStages:true})).toBe('hidden');
    expect(salesComposition({entitled:true,hasStages:false,hasOpportunities:true,mayConfigureStages:false})).toBe('full');
    expect(salesComposition({entitled:true,hasStages:true,hasOpportunities:false,mayConfigureStages:false})).toBe('full');
    expect(salesComposition({entitled:true,hasStages:false,hasOpportunities:false,mayConfigureStages:true})).toBe('setup');
    expect(salesComposition({entitled:true,hasStages:false,hasOpportunities:false,mayConfigureStages:false})).toBe('hidden');
  });
  it('labels only recorded qualifying events, in plain words',()=>{
    const label=(action:string,detail:Record<string,string>={})=>relationshipActivityLabel({action,detail,occurredAt:'2026-10-01T00:00:00Z'});
    expect(label('follow_up.completed',{kind:'meeting',title:'Site walk'})).toBe('Meeting held: Site walk');
    expect(label('follow_up.completed',{kind:'email'})).toBe('Email completed');
    expect(label('call.placed',{direction:'inbound'})).toBe('Call taken');
    expect(label('customer.classification_changed',{to_lifecycle:'customer'})).toBe('Became customer');
    expect(label('opportunity.stage_changed',{title:'Roof',stage_name:'Won'})).toBe('Roof moved to Won');
  });
});
