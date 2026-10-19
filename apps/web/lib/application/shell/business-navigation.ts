import { visibleAreas, areaAvailable, areaHref, AREAS, WORKSPACES } from '@/lib/navigation';
import { projectShell, type NavItem, type ShellInput, type ShellSection } from '@/lib/shell';
import { businessLabel, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';

const HOME_LABELS:Record<string,string>={sales:'Relationship overview',comms:'Communication overview',marketing:'Marketing overview',finance:'Money overview',field:'Work overview',ai:'Agents',automations:'Automation overview',studio:'Publishing overview'};
export function businessDestinations(input:ShellInput) {
  const eligible=visibleAreas(input.enabledModules,input.capabilities,input.featureAvailability,input.schedulableWork).filter(area=>area.segment!=='settings');
  for(const key of ['calendar','follow-ups']) {const area=AREAS.find(area=>area.segment===key)!;if(areaAvailable(key,{enabled:input.enabledModules,capabilities:input.capabilities,featureAvailability:input.featureAvailability,schedulableWork:input.schedulableWork}))eligible.push(area);}
  return eligible.map(area=>({key:area.segment,label:HOME_LABELS[area.segment]??area.label,href:areaHref(input.organizationId,area.segment),workspace:WORKSPACES.find(workspace=>workspace.key===area.workspace)?.label??'Organization'}));
}
/** Business vocabulary decorates the canonical hierarchy; it never replaces workspace ownership. */
export function projectBusinessNavigation(input: ShellInput, profile: BusinessProfile | null): ShellSection[] {
  const rank = new Map((profile?.navigation ?? []).map((key, index) => [key, index]));
  const ordered = (items: NavItem[]) => [...items].sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
  const decorate = (item: NavItem): NavItem => ({
    ...item,
    label: item.key.startsWith('workspace-') ? item.label : profile?.labels[item.key] ?? businessLabel(profile, item.label),
    ...(item.destinations ? { destinations: ordered(item.destinations).map(decorate) } : {}),
    ...(item.children ? { children: item.children.map(decorate) } : {}),
  });
  return projectShell(input).map(section => ({ ...section, items: section.items.map(decorate) }));
}
