'use server';

import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requestWorkflowReview } from '@/lib/domain/workflow-review/workflow-review';
import type { DemoRequestState } from './demo-form';

export async function requestDemoAction(
  _previous: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const db = await getDb();

  try {
    await requestWorkflowReview(db, {
      name: String(formData.get('name') ?? ''),
      businessName: String(formData.get('businessName') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      context: String(formData.get('context') ?? ''),
      teamSize: String(formData.get('teamSize') ?? ''),
      businessType: String(formData.get('businessType') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, done: false };
    }
    throw error;
  }

  return { error: null, done: true };
}
