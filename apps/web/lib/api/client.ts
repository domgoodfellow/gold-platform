import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * The one place `apps/web` calls a migrated FastAPI domain command over HTTP.
 *
 * **Forwards the caller's own token, and mints nothing** — the same authorization story
 * `lib/adapters/answering/gold-api.ts` already tells for the Ask feature, extended
 * from a read to a write. `apps/api`'s handler holds no role of its own; what it may do is
 * exactly what the token's own session may do, decided by RLS a moment later.
 *
 * **Not the answering-capability pattern.** `answeringProvider()` returns `null` when
 * unconfigured, because a deployment with no assistant is an ordinary, working deployment.
 * A migrated command has no such fallback — `updateCustomer`'s TypeScript implementation is not
 * kept in parallel as one (CLAUDE.md's rule against a second authoritative implementation) — so
 * an unconfigured deployment fails the action loudly rather than silently doing nothing.
 */
export async function requireAccessToken(db: Db): Promise<string> {
  const { data: session } = await db.auth.getSession();
  const token = session.session?.access_token;
  if (!token) {
    throw new DomainError('Sign in to continue.', 'auth.required');
  }
  return token;
}

export async function callDomainCommand<TResult>(
  path: string,
  input: { token: string; body: Record<string, unknown>; /** Defaults to 15 seconds; a read a page waits on asks for less. */ timeoutMs?: number },
): Promise<TResult> {
  const baseUrl = process.env.GOLD_API_URL;
  if (!baseUrl) {
    throw new DomainError(
      'This isn’t available yet.',
      'api.unconfigured',
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
    });
  } catch {
    throw new DomainError('The API could not be reached.', 'api.unreachable');
  }

  const payload: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { error, code } = payload as { error?: string; code?: string };
    throw new DomainError(error ?? `That could not be completed (${response.status}).`, `api.${code ?? 'failed'}`);
  }

  return payload as TResult;
}
