import { describe, expect, it } from 'vitest';
import { businessLabel, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { projectBusinessNavigation } from '@/lib/application/shell/business-navigation';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { AREAS } from '@/lib/navigation';
const profile:BusinessProfile={revision:1,nouns:{customer:{singular:'Patient',plural:'Patients'}},navigation:['customers','calls','calendar'],labels:{calls:'Phone desk'}};
describe('business vocabulary and navigation',()=>{
  it('resolves authored headings and actions while preserving other text',()=>{
    expect(businessLabel(profile,'Customers')).toBe('Patients');
    expect(businessLabel(profile,'New customer')).toBe('New patient');
    expect(businessLabel(profile,'Dialer')).toBe('Phone desk');
    expect(businessLabel(profile,'Customer Jane')).toBe('Customer Jane');
    expect(businessLabel(null,'Customers')).toBe('Customers');
  });
  it('keeps one ordered flat list and intersects choices with actual access',()=>{
    const input={organizationId:'org',enabledModules:new Set(['reception']),featureAvailability:new Set(AREAS.flatMap(a=>a.featureKeys??[])),capabilities:new Set(ALL_CAPABILITIES),schedulableWork:true};
    const sections=projectBusinessNavigation(input,profile);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map(i=>i.key)).toEqual(['customers','calls','calendar']);
    expect(sections[0].items.map(i=>i.label)).toEqual(['Patients','Phone desk','Calendar']);
    expect(sections[0].items.every(i=>!i.children)).toBe(true);
    expect(projectBusinessNavigation({...input,capabilities:new Set()},profile)[0].items.map(i=>i.key)).not.toContain('calls');
  });
});
