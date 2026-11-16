import { WORKSPACES, areaHref, type WorkspaceKey } from '@/lib/navigation';
export function calendarWorkspace(value?: string): WorkspaceKey | undefined {
  return WORKSPACES.find(workspace => workspace.key === value)?.key;
}
export function legacyCalendarHref(organizationId: string, workspace: WorkspaceKey, query: Record<string, string | string[] | undefined>) {
  const state = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (key !== 'scope') for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) state.append(key, entry);
  // Explicit organization scope stays broad. Otherwise a legacy workspace door retains its context.
  if (!state.has('workspace') && query.scope !== 'organization') state.set('workspace', workspace);
  return `${areaHref(organizationId, 'calendar')}${state.size ? `?${state}` : ''}`;
}
