'use server';

import { revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { renameIndustryTemplate, setIndustryTemplatePublished } from '@/lib/domain/configuration/proposals';
import { requirePlatformCapability } from '@/lib/route/platform';

export type ProvisionState = { error: string | null; provisioned: string | null };

/**
 * A caller. It reads the form, hands the domain what it typed, and turns a `DomainError` into a
 * sentence. It decides nothing — the normalisation, the founding role, and who may do this at
 * all live below it, so the AI onboarding flow that provisions later gets the same behaviour
 * without this file being involved.
 */
export async function provisionOrganizationAction(
  _previous: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const db = await getDb();

  const name = String(formData.get('name') ?? '');

  try {
    await provisionOrganization(db, {
      ownerEmail: String(formData.get('ownerEmail') ?? ''),
      name,
      displayName: String(formData.get('displayName') ?? ''),
      // Not the staff member's browser zone. See `provision.ts` — this business's clock is
      // a fact about the business, and defaulting it to where we are sitting would be the
      // platform deciding one.
      timezone: String(formData.get('timezone') ?? ''),
      currency: String(formData.get('currency') ?? ''),
      templateKey: String(formData.get('templateKey') ?? '') || undefined,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, provisioned: null };
    }
    throw error;
  }

  revalidatePlatform();
  return { error: null, provisioned: name.trim() };
}

export type TemplateState = { error: string | null; done: string | null };

/** Starting templates are looked after by staff holding `platform.catalogue`; the table's policy says so again. */
async function changeTemplate(change: () => Promise<void>, done: string): Promise<TemplateState> {
  try {
    await requirePlatformCapability('platform.catalogue');
    await change();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, done: null };
    throw error;
  }
  revalidatePlatform();
  return { error: null, done };
}

export async function setTemplatePublishedAction(_previous: TemplateState, formData: FormData): Promise<TemplateState> {
  const published = formData.get('published') === 'true';
  const name = String(formData.get('name') ?? '');
  return changeTemplate(
    async () => setIndustryTemplatePublished(await getDb(), { key: String(formData.get('key') ?? ''), published }),
    published ? `${name} is offered to new businesses.` : `${name} is no longer offered to new businesses.`,
  );
}

export async function renameTemplateAction(_previous: TemplateState, formData: FormData): Promise<TemplateState> {
  return changeTemplate(
    async () => renameIndustryTemplate(await getDb(), {
      key: String(formData.get('key') ?? ''), name: String(formData.get('name') ?? ''), category: String(formData.get('category') ?? ''),
    }),
    'Template renamed.',
  );
}
