'use server';

import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { submitPublicInquiry } from '@/lib/domain/public-intake/public-intake';
import type { ContactState } from './contact-form';

export async function sendContactAction(_previous: ContactState, formData: FormData): Promise<ContactState> {
  const db = await getDb();

  try {
    await submitPublicInquiry(db, {
      kind: 'contact',
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      businessName: String(formData.get('businessName') ?? ''),
      topic: String(formData.get('topic') ?? ''),
      context: String(formData.get('message') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, done: false };
    throw error;
  }

  return { error: null, done: true };
}
