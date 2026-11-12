import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';
import { isCapability, type Capability } from './capabilities';

/**
 * Roles suggested for this kind of business, as starting points for a new role.
 *
 * They come from the platform's published industry templates, never from a guess: the template
 * the business started from, and any template whose name or category is the industry the business gave
 * itself in General. A business with neither gets none and still has the general starting points.
 * A suggestion only fills the new-role form; the owner reviews and saves it like any other role,
 * the saved role records nothing about where it came from, and only permissions the platform
 * enforces can appear. A role the business already has by that name is not suggested again.
 */
export type RoleSuggestion = {
  name: string;
  capabilities: Capability[];
  /** The template's name, shown so the owner knows why it is offered. */
  from: string;
};

export async function listRoleSuggestions(db: Db, input: { organizationId: string; existingRoleNames: readonly string[] }): Promise<RoleSuggestion[]> {
  const [identity, templates] = await Promise.all([
    db.from('organization_identity').select('industry, starting_template_key').eq('organization_id', input.organizationId).maybeSingle(),
    db.from('industry_templates').select('key, name, category, shape, position').eq('published', true).order('position', { ascending: true }),
  ]);
  if (identity.error) throw fromDatabaseError(identity.error, 'role_suggestions.identity_failed');
  if (templates.error) throw fromDatabaseError(templates.error, 'role_suggestions.templates_failed');

  const startedFrom = identity.data?.starting_template_key ?? null;
  const industry = identity.data?.industry?.trim().toLowerCase() ?? '';
  const taken = new Set(input.existingRoleNames.map((name) => name.trim().toLowerCase()));
  const suggestions: RoleSuggestion[] = [];

  // The template the business actually started from comes first; a category match follows.
  const matching = (templates.data ?? [])
    .filter((template) => template.key === startedFrom || (industry.length > 0 && [template.name, template.category].some((value) => value.trim().toLowerCase() === industry)))
    .sort((a, b) => Number(b.key === startedFrom) - Number(a.key === startedFrom));

  for (const template of matching) {
    const shape = template.shape;
    const roles = shape && typeof shape === 'object' && !Array.isArray(shape) && Array.isArray(shape.roles) ? shape.roles : [];
    for (const role of roles) {
      if (!role || typeof role !== 'object' || Array.isArray(role)) continue;
      const name = typeof role.name === 'string' ? role.name.trim() : '';
      if (!name || taken.has(name.toLowerCase())) continue;
      taken.add(name.toLowerCase());
      const capabilities = Array.isArray(role.capabilities)
        ? role.capabilities.filter((value): value is Capability => typeof value === 'string' && isCapability(value))
        : [];
      suggestions.push({ name, capabilities, from: template.name });
    }
  }
  return suggestions;
}
