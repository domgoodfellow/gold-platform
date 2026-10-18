import { visibleAreas, areaAvailable, areaHref, AREAS } from '@/lib/navigation';
import type { ShellInput, ShellSection } from '@/lib/shell';
import { businessLabel, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';

const HOME_LABELS:Record<string,string>={sales:'Relationship overview',comms:'Communication overview',marketing:'Marketing overview',finance:'Money overview',field:'Work overview',ai:'Agents',automations:'Automation overview',studio:'Publishing overview'};
export function businessDestinations(input:ShellInput) {
  const eligible=visibleAreas(input.enabledModules,input.capabilities,input.featureAvailability,input.schedulableWork).filter(area=>area.segment!=='settings');
  for(const key of ['calendar','follow-ups']) {const area=AREAS.find(area=>area.segment===key)!;if(areaAvailable(key,{enabled:input.enabledModules,capabilities:input.capabilities,featureAvailability:input.featureAvailability,schedulableWork:input.schedulableWork}))eligible.push(area);}
  return eligible.map(area=>({key:area.segment,label:HOME_LABELS[area.segment]??area.label,href:areaHref(input.organizationId,area.segment)}));
}
export function projectBusinessNavigation(input:ShellInput,profile:BusinessProfile|null):ShellSection[] {
  const eligible=businessDestinations(input);
  const ordered=profile?.navigation.length?profile.navigation.flatMap(key=>{const item=eligible.find(item=>item.key===key);return item?[item]:[];}):eligible;
  return [{key:'home',label:null,items:ordered.map(item=>({...item,label:profile?.labels[item.key]??businessLabel(profile,item.label),section:'home',exact:item.key==='home'}))}];
}
