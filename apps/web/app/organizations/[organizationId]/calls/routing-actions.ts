'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireAccessToken } from '@/lib/api/client';
import { previewInboundRoute, previewOutboundIdentity, type OutboundIdentityDecision, type RouteDecision } from '@/lib/api/routing';
import {
  createRoute,
  listRouteTargets,
  setRouteEnabled,
  setRouteTargets,
  updateRoute,
  type RouteInput,
} from '@/lib/domain/reception/routing';
import { requireOrganization } from '@/lib/route/organization';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(organizationId: string, run: () => Promise<T>, revalidate = true): Promise<ActionResult<T>> {
  try {
    const data = await run();
    if (revalidate) {
      revalidatePath(`/organizations/${organizationId}/calls`);
  revalidatePath(`/organizations/${organizationId}/comms/configuration/calling`);
      revalidatePath(`/organizations/${organizationId}/comms`);
      revalidatePath(`/organizations/${organizationId}/comms/configuration/calling`);
    }
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function createRouteAction(
  organizationId: string,
  input: RouteInput & { primaryMemberIds?: string[]; fallbackMemberIds?: string[] },
): Promise<ActionResult<{ routeId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    const routeId = await createRoute(db, { organizationId, ...input });
    if (input.destinationType === 'members') {
      await setRouteTargets(db, { organizationId, routeId, slot: 'primary', memberIds: input.primaryMemberIds ?? [] });
    }
    if (input.fallbackType === 'members') {
      await setRouteTargets(db, { organizationId, routeId, slot: 'fallback', memberIds: input.fallbackMemberIds ?? [] });
    }
    return { routeId };
  });
}

export async function readRouteTargetsAction(organizationId: string, routeId: string) {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => listRouteTargets(await getDb(), { organizationId, routeId }), false);
}

export async function updateRouteAction(
  organizationId: string,
  routeId: string,
  input: Partial<RouteInput> & { primaryMemberIds?: string[]; fallbackMemberIds?: string[] },
): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await updateRoute(db, { organizationId, routeId, ...input });
    if (input.primaryMemberIds) {
      await setRouteTargets(db, { organizationId, routeId, slot: 'primary', memberIds: input.primaryMemberIds });
    }
    if (input.fallbackMemberIds) {
      await setRouteTargets(db, { organizationId, routeId, slot: 'fallback', memberIds: input.fallbackMemberIds });
    }
    return null;
  });
}

export async function setRouteEnabledAction(
  organizationId: string,
  input: { routeId: string; enabled: boolean },
): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await setRouteEnabled(db, { organizationId, ...input });
    return null;
  });
}

export async function previewInboundRouteAction(
  organizationId: string,
  input: { numberId?: string | null; fromNumber?: string | null; at?: string | null },
): Promise<ActionResult<RouteDecision>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    const token = await requireAccessToken(db);
    return previewInboundRoute({ token, organizationId, ...input });
  });
}

export async function previewOutboundIdentityAction(
  organizationId: string,
  input: { memberId: string; mode: 'auto' | 'manual'; selectedPhoneNumberId?: string | null },
): Promise<ActionResult<OutboundIdentityDecision>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    const token = await requireAccessToken(db);
    return previewOutboundIdentity({ token, organizationId, ...input });
  });
}
