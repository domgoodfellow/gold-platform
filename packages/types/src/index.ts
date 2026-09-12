import type { CONTEXT_TYPES } from '@gold/config';

export type ContextType = (typeof CONTEXT_TYPES)[number];

export type OrganizationId = string;
export type UserId = string;

/**
 * Where a caller is acting, and under what authority — the shape the context switcher and the
 * organization resolver both hand around. Deliberately generic over the capability type rather
 * than importing one: `Capability` is owned by `apps/web/lib/domain/tenancy/capabilities.ts`
 * (business logic lives in the domain layer, not a shared package), so a caller supplies its own
 * capability type at the point of use.
 *
 * The two organization shapes are discriminated on `accessMode` for a reason that matters: a
 * `support` session carries no `role` and no `capabilities` at all, because it is not a
 * membership and must never be treated like one. Reaching for `.role` on a context without first
 * narrowing on `accessMode` is a type error, not a runtime surprise.
 */
export type ContextDescriptor<Capability extends string = string> =
  | { type: 'platform' }
  | {
      type: 'organization';
      organizationId: OrganizationId;
      accessMode: 'member';
      role: string;
      capabilities: Capability[];
    }
  | {
      type: 'organization';
      organizationId: OrganizationId;
      accessMode: 'support';
      sessionId: string;
      startedAt: string;
      expiresAt: string;
    };
