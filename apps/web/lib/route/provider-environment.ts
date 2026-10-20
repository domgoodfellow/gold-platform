import type { Db } from '@/lib/db/types';
import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import { DomainError } from '@/lib/domain/errors';

/**
 * Providers with the generic, API-key-only account model (`ProviderConfiguration`) rather than
 * Twilio's own subaccount/binding one. Route-owned: naming which
 * providers this platform built account UI for is a fact about this deployment's routes, never
 * something `lib/domain/` may say. Named once so the Providers list and a Provider's own
 * detail route agree, and held to the API's own registry (`app.providers.providers.operations_for`)
 * by `provider-account-adapters.test.ts`, so the two lists cannot drift apart.
 *
 * `resend` joined this set once platform email moved onto `platform_provider_accounts` (the platform-provider-account rule,
 * work order 1 §6); `RESEND_API_KEY`/`PLATFORM_EMAIL_FROM_ADDRESS` are the bootstrap fallback
 * `app.services.platform_email` tries when no account is recorded, never a second UI for it.
 */
export const GENERIC_ACCOUNT_PROVIDER_KEYS = new Set(['openai', 'anthropic', 'google', 'vercel', 'resend', 'voice_agent']);

/**
 * Whether GildOps' own invitation email can be sent, as the API judges it from its own settings and
 * a read-only look at the Resend account (`/platform/email-readiness`, staff only). Never inferred
 * from this web project's environment: the web does not send email, so its settings prove nothing.
 * The answer carries states and setting names, never a key or an address beyond its domain.
 */
export type PlatformEmailReadinessState =
  | 'not_configured' | 'misconfigured' | 'provider_unavailable' | 'configured_unverified' | 'ready_for_test' | 'live_verified' | 'api_unreachable';

export type PlatformEmailReadiness = {
  state: PlatformEmailReadinessState;
  detail: string;
  fromDomain: string | null;
  domainStatus: string | null;
  credentialSource: 'platform_account' | 'environment' | null;
  checks: { key: string; label: string; state: 'ok' | 'missing' | 'problem' | 'unknown'; detail: string }[];
  evidence: { lastDeliveredAt: string | null; lastAcceptedAt: string | null; lastFailedAt: string | null; lastFailure: string | null };
};

type Answer = {
  state: Exclude<PlatformEmailReadinessState, 'api_unreachable'>; detail: string; from_domain?: string | null; domain_status?: string | null;
  credential_source?: 'platform_account' | 'environment' | null; checks?: PlatformEmailReadiness['checks'];
  evidence?: { last_delivered_at?: string | null; last_accepted_at?: string | null; last_failed_at?: string | null; last_failure?: string | null };
};

export async function platformEmailReadiness(db: Db): Promise<PlatformEmailReadiness> {
  try {
    const answer = await callDomainCommand<Answer>('/platform/email-readiness', { token: await requireAccessToken(db), body: {}, timeoutMs: 20_000 });
    return {
      state: answer.state, detail: answer.detail, fromDomain: answer.from_domain ?? null, domainStatus: answer.domain_status ?? null,
      credentialSource: answer.credential_source ?? null, checks: answer.checks ?? [],
      evidence: {
        lastDeliveredAt: answer.evidence?.last_delivered_at ?? null, lastAcceptedAt: answer.evidence?.last_accepted_at ?? null,
        lastFailedAt: answer.evidence?.last_failed_at ?? null, lastFailure: answer.evidence?.last_failure ?? null,
      },
    };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const detail = error.code === 'api.unconfigured'
      ? 'This web project has no GOLD_API_URL, so it cannot reach the API that sends invitations.'
      : error.code === 'api.unreachable' ? 'The API that sends invitations could not be reached from this web project (GOLD_API_URL).' : null;
    if (!detail) {
      // It answered, but does not offer this check: missing its own settings, or an older version.
      return { state: 'not_configured', detail: 'The API did not report email readiness. It may be missing its Supabase settings, or be a version from before this check existed.', fromDomain: null, domainStatus: null, credentialSource: null, checks: [], evidence: { lastDeliveredAt: null, lastAcceptedAt: null, lastFailedAt: null, lastFailure: null } };
    }
    return { state: 'api_unreachable', detail, fromDomain: null, domainStatus: null, credentialSource: null, checks: [], evidence: { lastDeliveredAt: null, lastAcceptedAt: null, lastFailedAt: null, lastFailure: null } };
  }
}
