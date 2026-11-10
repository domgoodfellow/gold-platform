'use server';

import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { submitPublicInquiry } from '@/lib/domain/public-intake/public-intake';
import { DIALER_QUESTIONS, inquiryTopic, topicNeeds } from '@/lib/marketing/inquiry';
import type { DemoRequestState, DemoRequestValues } from './demo-form';

/** What the visitor typed, handed back on a refusal so the form opens with it rather than empty. */
function submittedValues(formData: FormData): DemoRequestValues {
  const text = (name: string) => String(formData.get(name) ?? '');
  return {
    name: text('name'),
    email: text('email'),
    businessName: text('businessName'),
    phone: text('phone'),
    product: text('product'),
    teamSize: text('teamSize'),
    context: text('context'),
    dialerCallers: text(DIALER_QUESTIONS.callers.name),
    dialerNumbers: text(DIALER_QUESTIONS.numbers.name),
    dialerDirection: text(DIALER_QUESTIONS.direction.name),
    dialerVolume: text(DIALER_QUESTIONS.volume.name),
    dialerExtras: formData.getAll(DIALER_QUESTIONS.extras.name).map(String),
  };
}

export async function requestDemoAction(
  previous: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  // Only a product this site offers is kept; anything else is sent as no product at all.
  const topic = inquiryTopic(formData.get('product'));
  const db = await getDb();

  try {
    await submitPublicInquiry(db, {
      kind: 'demo',
      name: String(formData.get('name') ?? ''),
      businessName: String(formData.get('businessName') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      context: String(formData.get('context') ?? ''),
      teamSize: String(formData.get('teamSize') ?? ''),
      businessType: topic?.label ?? '',
      needs: topicNeeds(topic, formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, done: false, attempt: previous.attempt + 1, values: submittedValues(formData) };
    }
    throw error;
  }

  return { error: null, done: true, attempt: previous.attempt + 1, product: topic?.offering?.name ?? null };
}
