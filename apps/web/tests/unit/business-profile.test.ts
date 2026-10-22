import { describe, expect, it } from 'vitest';
import { businessLabel, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { workspaceNavigation } from '@/lib/shell';
import { businessDestinations, projectBusinessNavigation } from '@/lib/application/shell/business-navigation';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { AREAS } from '@/lib/navigation';
const profile:BusinessProfile={revision:1,nouns:{customer:{singular:'Patient',plural:'Patients'}},navigation:['customers','calls','calendar'],labels:{calls:'Phone desk',work:'Appointments',sales:'Relationship overview',finance:'Money overview'}};
describe('business vocabulary and navigation',()=>{
  it('resolves authored headings and actions while preserving other text',()=>{
    expect(businessLabel(profile,'Customers')).toBe('Patients');
    expect(businessLabel(profile,'New customer')).toBe('New patient');
    expect(businessLabel(profile,'Dialer')).toBe('Phone desk');
    expect(businessLabel(profile,'Customer Jane')).toBe('Customer Jane');
    expect(businessLabel(null,'Customers')).toBe('Customers');
  });
  it('keeps actual workspace groups and applies vocabulary inside their context', () => {
    const input = { organizationId: '11111111-1111-4111-8111-111111111111', enabledModules: new Set(['reception']), featureAvailability: new Set(AREAS.flatMap(area => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES), schedulableWork: true };
    const sections = projectBusinessNavigation(input, profile);
    expect(sections.map(section => section.key)).toEqual(['home', 'library', 'workspaces']);
    const workspaces = sections.find(section => section.key === 'workspaces')!.items;
    expect(workspaces.map(item => item.label)).toEqual(['CRM', 'Communications', 'Marketing', 'Support', 'Work', 'Finance', 'Automations', 'AI', 'Studio']);
    expect(sections.flatMap(section => section.items).map(item => item.key)).not.toEqual(expect.arrayContaining(['customers', 'calls', 'finance-invoices']));
    expect(workspaceNavigation(sections, '/organizations/11111111-1111-4111-8111-111111111111/crm/contacts')!.sections[0].items.find(item => item.key === 'customers')!.label).toBe('Patients');
    expect(workspaceNavigation(sections, '/organizations/11111111-1111-4111-8111-111111111111/calls')!.sections[0].items.find(item => item.key === 'calls')!.label).toBe('Phone desk');
    expect(workspaceNavigation(sections, '/organizations/11111111-1111-4111-8111-111111111111/finance/invoices')!.workspace.label).toBe('Finance');
    const destinations = businessDestinations(input);
    expect(destinations.find(item => item.key === 'customers')!.workspace).toBe('CRM');
    expect(destinations.find(item => item.key === 'calls')!.workspace).toBe('Communications');
    const restricted = projectBusinessNavigation({ ...input, capabilities: new Set() }, profile);
    expect(restricted.find(section => section.key === 'workspaces')!.items.flatMap(item => item.destinations ?? []).map(item => item.key)).not.toContain('calls');
  });
  it('keeps Dashboard first and CRM Contacts before Pipeline despite an older saved order',()=>{
    const input={organizationId:'org',enabledModules:new Set(['reception']),featureAvailability:new Set(AREAS.flatMap(area=>area.featureKeys??[])),capabilities:new Set(ALL_CAPABILITIES)};
    const sections=projectBusinessNavigation(input,{...profile,navigation:['opportunity-pipeline','customers'],labels:{'workspace-dashboard':'Old overview'}});
    const crm=sections.flatMap(section=>section.items).find(item=>item.key==='workspace-crm')!;
    expect(crm.destinations?.map(item=>item.key)).toEqual(['workspace-dashboard','customers','opportunity-pipeline']);
    expect(crm.destinations?.[0].label).toBe('Dashboard');
  });

});
