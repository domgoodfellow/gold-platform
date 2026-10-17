import { callDomainCommand } from './client';

/**
 * Route resolution, authoritative in `apps/api/app/domains/communications/routing.py`.
 *
 * **Preview and runtime call the same function.** These wrappers exist so the Configure screen's
 * "Test route" and the dialer's AUTO/MANUAL identity both reach the one resolver over HTTP,
 * exactly as `wrap_up.ts` reaches `wrap_up_call` — never a second, TS-side approximation of
 * either decision (the runtime-boundary rule: the two runtimes cannot call each other, so there is nowhere else for
 * this logic to live that both a live call and a preview screen could reach).
 */

export type RouteDecision = {
  routeId: string | null;
  matched: boolean;
  withinHours: boolean;
  targetType: 'members' | 'external_number' | 'voicemail' | 'none';
  memberIds: string[];
  externalNumber: string | null;
  ringStrategy: string | null;
  ringTimeoutSeconds: number | null;
  reason: string;
  fallbackUsed: boolean;
  warnings: string[];
};

export async function previewInboundRoute(input: {
  token: string;
  organizationId: string;
  numberId?: string | null;
  fromNumber?: string | null;
  at?: string | null;
}): Promise<RouteDecision> {
  const result = await callDomainCommand<{
    route_id: string | null;
    matched: boolean;
    within_hours: boolean;
    target_type: RouteDecision['targetType'];
    member_ids: string[];
    external_number: string | null;
    ring_strategy: string | null;
    ring_timeout_seconds: number | null;
    reason: string;
    fallback_used: boolean;
    warnings: string[];
  }>('/routing/preview-inbound', {
    token: input.token,
    body: {
      organization_id: input.organizationId,
      number_id: input.numberId ?? null,
      from_number: input.fromNumber ?? null,
      at: input.at ?? null,
    },
  });

  return {
    routeId: result.route_id,
    matched: result.matched,
    withinHours: result.within_hours,
    targetType: result.target_type,
    memberIds: result.member_ids,
    externalNumber: result.external_number,
    ringStrategy: result.ring_strategy,
    ringTimeoutSeconds: result.ring_timeout_seconds,
    reason: result.reason,
    fallbackUsed: result.fallback_used,
    warnings: result.warnings,
  };
}

export type OutboundIdentityDecision = {
  modeRequested: 'auto' | 'manual';
  modeApplied: 'auto' | 'manual';
  phoneNumberId: string | null;
  e164: string | null;
  reason: string;
  warnings: string[];
};

export async function previewOutboundIdentity(input: {
  token: string;
  organizationId: string;
  memberId: string;
  mode: 'auto' | 'manual';
  selectedPhoneNumberId?: string | null;
}): Promise<OutboundIdentityDecision> {
  const result = await callDomainCommand<{
    mode_requested: 'auto' | 'manual';
    mode_applied: 'auto' | 'manual';
    phone_number_id: string | null;
    e164: string | null;
    reason: string;
    warnings: string[];
  }>('/routing/preview-outbound', {
    token: input.token,
    body: {
      organization_id: input.organizationId,
      member_id: input.memberId,
      mode: input.mode,
      selected_phone_number_id: input.selectedPhoneNumberId ?? null,
    },
  });

  return {
    modeRequested: result.mode_requested,
    modeApplied: result.mode_applied,
    phoneNumberId: result.phone_number_id,
    e164: result.e164,
    reason: result.reason,
    warnings: result.warnings,
  };
}
