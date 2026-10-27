import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireOrganization } from './organization';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { areaAvailable, configTarget, configTargetOffered, workspaceConfigureItems, type WorkspaceKey } from '@/lib/navigation';

export const loadConfigurationContext = cache(async (organizationId: string) => {
  const context = await requireOrganization(organizationId);
  const [states, schedulableWork] = await Promise.all([
    organizationResolvedFeatureStates(context.db, { organizationId }),
    hasSchedulableWork(context.db, { organizationId }),
  ]);
  return { ...context, gate: { enabledModules: activeModuleKeys(states), featureAvailability: availableFeatureKeys(states), capabilities: new Set(context.organization.capabilities), schedulableWork } };
});

export async function requireWorkspaceConfiguration(organizationId: string, workspace: WorkspaceKey) {
  const context = await loadConfigurationContext(organizationId);
  const sections = workspaceConfigureItems(organizationId, workspace, context.gate);
  if (!sections.length) notFound();
  return { ...context, sections };
}

/** Pages enforce their own target before protected reads, independently of the persistent layout. */
export async function requireConfigurationTarget(organizationId: string, targetKey: string, allowNumberRead = false) {
  const context = await loadConfigurationContext(organizationId);
  if (!configTargetOffered(configTarget(targetKey), context.gate) && !(allowNumberRead && targetKey === 'phone-numbers' && areaAvailable('comms-numbers', { enabled: context.gate.enabledModules, ...context.gate }))) notFound();
  return context;
}


/** Whether this member is offered `targetKey`, under the same gate its page enforces. */
export async function configurationTargetOffered(organizationId: string, targetKey: string): Promise<boolean> {
  const { gate } = await loadConfigurationContext(organizationId);
  return configTargetOffered(configTarget(targetKey), gate);
}

export async function configurationLayoutSections(organizationId: string, workspace: WorkspaceKey) {
  const context = await loadConfigurationContext(organizationId);
  const sections = workspaceConfigureItems(organizationId, workspace, context.gate);
  if (sections.length) return sections;
  if (workspace === 'communications' && areaAvailable('comms-numbers', { enabled: context.gate.enabledModules, ...context.gate })) {
    return [{ key: 'phone-numbers', label: 'Numbers & assignments', href: `/organizations/${organizationId}/${configTarget('phone-numbers').path}` }];
  }
  notFound();
}


export async function requireOperatingArea(organizationId: string, segment: string) {
  const context = await loadConfigurationContext(organizationId);
  if (!areaAvailable(segment, { enabled: context.gate.enabledModules, ...context.gate })) notFound();
  return context;
}
