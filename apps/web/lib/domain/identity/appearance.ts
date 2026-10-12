import type { PersonalAppearancePreferences } from '@gold/ui/design-system';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export const DEFAULT_APPEARANCE: PersonalAppearancePreferences = {};
const choices = {
  appearance: ['system', 'light', 'dark'], preset: ['minimal', 'layered', 'expressive'],
  density: ['compact', 'comfortable'], shape: ['square', 'rounded', 'soft'], motion: ['system', 'reduced'],
} as const;

/** Absence is an override decision, not a fabricated preset. Closed values only. */
export function validateAppearance(input: unknown): PersonalAppearancePreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('Choose supported appearance settings.', 'identity.appearance_invalid');
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(choices, key)) throw new DomainError('Choose supported appearance settings.', 'identity.appearance_invalid');
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !(choices[key as keyof typeof choices] as readonly string[]).includes(value)) throw new DomainError('Choose supported appearance settings.', 'identity.appearance_invalid');
    output[key] = value;
  }
  return output;
}

async function accountId(db: Db) {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) throw new DomainError('Sign in to configure your appearance.', 'auth.required');
  return data.user.id;
}

export async function getAppearance(db: Db): Promise<PersonalAppearancePreferences> {
  const id = await accountId(db);
  const { data, error } = await db.from('account_appearance_preferences').select('appearance,preset,density,shape,motion').eq('user_id', id).maybeSingle();
  if (error) throw new DomainError('Unable to load your appearance. Try again.', 'identity.appearance_read_failed');
  return data ? validateAppearance(data) : DEFAULT_APPEARANCE;
}

export async function saveAppearance(db: Db, input: unknown): Promise<PersonalAppearancePreferences> {
  const id = await accountId(db);
  const selection = validateAppearance(input);
  const { error } = await db.from('account_appearance_preferences').upsert({
    user_id: id, appearance: selection.appearance ?? 'system', preset: selection.preset ?? null,
    density: selection.density ?? null, shape: selection.shape ?? null, motion: selection.motion ?? null,
    updated_at: new Date().toISOString(),
  }).select('user_id').single();
  if (error) throw new DomainError('Unable to save your appearance. Your changes remain unsaved.', 'identity.appearance_write_failed');
  return { ...selection, appearance: selection.appearance ?? 'system' };
}

export async function resetAppearance(db: Db): Promise<PersonalAppearancePreferences> {
  const id = await accountId(db);
  const { error } = await db.from('account_appearance_preferences').delete().eq('user_id', id);
  if (error) throw new DomainError('Unable to reset your appearance. Try again.', 'identity.appearance_reset_failed');
  return DEFAULT_APPEARANCE;
}
