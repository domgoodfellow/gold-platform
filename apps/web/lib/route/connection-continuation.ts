/** One application-owned continuation, bound to the browser nonce and verified organization. */
export const OAUTH_CONTINUATION_COOKIE = 'gold_oauth_continuation';

export function contactImportContinuation(organizationId: string, nonce: string): string {
  return JSON.stringify({ intent: 'contact-import', organizationId, nonce });
}

export function connectionContinuation(cookie: string | undefined, nonce: string, organizationId: string | null): string | null {
  if (!cookie || cookie.length > 1000 || !nonce || !organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) return null;
  try {
    const stored: unknown = JSON.parse(cookie);
    if (!stored || typeof stored !== 'object') return null;
    const value = stored as Record<string, unknown>;
    return value.intent === 'contact-import' && value.organizationId === organizationId && value.nonce === nonce
      ? `/organizations/${organizationId}/crm/contacts?import=1` : null;
  } catch { return null; }
}
