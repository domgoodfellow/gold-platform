'use server';
import { revalidatePath } from 'next/cache';
import { getPortalDb } from '@/lib/db/portal-server';
import { requirePortalRequestContext } from '@/lib/domain/portal/request-context';
import { DomainError } from '@/lib/domain/errors';

export type NotificationPreferenceState = { error: string | null; message: string | null; challengeId?: string };
export async function notificationPreferenceAction(previous: NotificationPreferenceState, form: FormData): Promise<NotificationPreferenceState> {
  const db = await getPortalDb();
  try {
    await requirePortalRequestContext(db);
    const operation = form.get('operation');
    if (operation === 'propose') {
      const { data, error } = await db.rpc('propose_notification_recipient', { p_email_address: String(form.get('email') ?? ''), p_purposes: form.getAll('purposes').map(String) });
      if (error) return { ...previous, error: error.message, message: null };
      return { error: null, message: 'Confirmation queued. Enter the code when the email arrives. Your preferences change only after confirmation.', challengeId: data };
    }
    if (operation === 'confirm') {
      const { data, error } = await db.rpc('confirm_notification_recipient', { p_challenge_id: String(form.get('challengeId') ?? ''), p_code: String(form.get('code') ?? '') });
      if (error || !data) return { ...previous, error: 'The code could not be confirmed. Check the code and use the Portal session where you requested it. Codes expire after 20 minutes and five attempts.', message: null };
    } else if (operation === 'withdraw') {
      const { error } = await db.rpc('withdraw_notification_consent');
      if (error) return { ...previous, error: error.message, message: null };
    } else return { ...previous, error: 'Unsupported preference operation.', message: null };
    revalidatePath('/portal', 'layout');
    return { error: null, message: operation === 'withdraw' ? 'Email notifications are off. Your Portal access is unchanged.' : 'Email verified and notification preferences recorded.' };
  } catch (error) {
    return { ...previous, error: error instanceof DomainError ? error.message : 'Preferences could not be updated. Refresh and try again.', message: null };
  }
}
