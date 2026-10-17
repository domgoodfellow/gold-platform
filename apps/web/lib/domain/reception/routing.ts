import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Route configuration — the data a tenant edits under Communications Configure. The *decision*
 * a route produces for a live call is a different question, answered once, in Python
 * (`apps/api/app/domains/communications/routing.py`): the two runtimes cannot call each other
 *, and the carrier's own webhook needs that same answer synchronously, so the resolver
 * cannot live here — only here would make `previewInboundRoute` a second, drifting copy of it,
 * which the work order explicitly refuses. This file is CRUD only.
 */

export type RouteWhenMode = 'always' | 'business_hours';
export type RingStrategy = 'everyone' | 'sequential' | 'round_robin';
export type DestinationType = 'members' | 'external_number' | 'route';
export type FallbackType = 'voicemail' | 'members' | 'external_number' | 'route' | 'none';

export type Route = {
  id: string;
  name: string;
  numberId: string | null;
  enabled: boolean;
  whenMode: RouteWhenMode;
  ringStrategy: RingStrategy;
  ringTimeoutSeconds: number;
  destinationType: DestinationType;
  destinationExternalNumber: string | null;
  destinationRouteId: string | null;
  fallbackType: FallbackType;
  fallbackExternalNumber: string | null;
  fallbackRouteId: string | null;
  callbackAffinityEnabled: boolean;
};

export type RouteTarget = { id: string; routeId: string; slot: 'primary' | 'fallback'; memberId: string; position: number };

const ROUTE_SELECT =
  'id, name, number_id, enabled, when_mode, ring_strategy, ring_timeout_seconds, destination_type, destination_external_number, destination_route_id, fallback_type, fallback_external_number, fallback_route_id, callback_affinity_enabled';

type RouteRow = {
  id: string;
  name: string;
  number_id: string | null;
  enabled: boolean;
  when_mode: string;
  ring_strategy: string;
  ring_timeout_seconds: number;
  destination_type: string;
  destination_external_number: string | null;
  destination_route_id: string | null;
  fallback_type: string;
  fallback_external_number: string | null;
  fallback_route_id: string | null;
  callback_affinity_enabled: boolean;
};

function toRoute(row: RouteRow): Route {
  return {
    id: row.id,
    name: row.name,
    numberId: row.number_id,
    enabled: row.enabled,
    whenMode: row.when_mode as RouteWhenMode,
    ringStrategy: row.ring_strategy as RingStrategy,
    ringTimeoutSeconds: row.ring_timeout_seconds,
    destinationType: row.destination_type as DestinationType,
    destinationExternalNumber: row.destination_external_number,
    destinationRouteId: row.destination_route_id,
    fallbackType: row.fallback_type as FallbackType,
    fallbackExternalNumber: row.fallback_external_number,
    fallbackRouteId: row.fallback_route_id,
    callbackAffinityEnabled: row.callback_affinity_enabled,
  };
}

export async function listRoutes(db: Db, input: { organizationId: string }): Promise<Route[]> {
  const { data, error } = await db
    .from('communication_routes')
    .select(ROUTE_SELECT)
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });
  if (error) throw new DomainError(error.message, 'routing.list_failed');
  return (data ?? []).map(toRoute);
}

export async function getRoute(db: Db, input: { organizationId: string; routeId: string }): Promise<Route | null> {
  const { data, error } = await db
    .from('communication_routes')
    .select(ROUTE_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('id', input.routeId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'routing.read_failed');
  return data ? toRoute(data) : null;
}

/** The route bound to one number, or the organization's catch-all if none names it specifically. */
export async function getEffectiveRoute(
  db: Db,
  input: { organizationId: string; numberId: string | null },
): Promise<Route | null> {
  if (input.numberId) {
    const own = await db
      .from('communication_routes')
      .select(ROUTE_SELECT)
      .eq('organization_id', input.organizationId)
      .eq('number_id', input.numberId)
      .maybeSingle();
    if (own.error) throw new DomainError(own.error.message, 'routing.read_failed');
    if (own.data) return toRoute(own.data);
  }
  const fallback = await db
    .from('communication_routes')
    .select(ROUTE_SELECT)
    .eq('organization_id', input.organizationId)
    .is('number_id', null)
    .maybeSingle();
  if (fallback.error) throw new DomainError(fallback.error.message, 'routing.read_failed');
  return fallback.data ? toRoute(fallback.data) : null;
}

function writeError(error: { code?: string; message: string }): DomainError {
  return new DomainError(
    error.code === '42501' ? 'Your role cannot change routing here.' : error.message,
    'routing.write_failed',
  );
}

export type RouteInput = {
  name: string;
  numberId: string | null;
  enabled?: boolean;
  whenMode: RouteWhenMode;
  ringStrategy: RingStrategy;
  ringTimeoutSeconds: number;
  destinationType: DestinationType;
  destinationExternalNumber?: string | null;
  destinationRouteId?: string | null;
  fallbackType: FallbackType;
  fallbackExternalNumber?: string | null;
  fallbackRouteId?: string | null;
  callbackAffinityEnabled?: boolean;
};

export async function createRoute(db: Db, input: { organizationId: string } & RouteInput): Promise<string> {
  const actor = await requireActor(db);
  const { data, error } = await db
    .from('communication_routes')
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim(),
      number_id: input.numberId,
      enabled: input.enabled ?? true,
      when_mode: input.whenMode,
      ring_strategy: input.ringStrategy,
      ring_timeout_seconds: input.ringTimeoutSeconds,
      destination_type: input.destinationType,
      destination_external_number: input.destinationExternalNumber ?? null,
      destination_route_id: input.destinationRouteId ?? null,
      fallback_type: input.fallbackType,
      fallback_external_number: input.fallbackExternalNumber ?? null,
      fallback_route_id: input.fallbackRouteId ?? null,
      callback_affinity_enabled: input.callbackAffinityEnabled ?? false,
      created_by: actor.id,
    })
    .select('id')
    .single();
  if (error) throw writeError(error);
  return data.id;
}

export async function updateRoute(
  db: Db,
  input: { organizationId: string; routeId: string } & Partial<RouteInput>,
): Promise<void> {
  const patch: {
    updated_at: string;
    name?: string;
    number_id?: string | null;
    enabled?: boolean;
    when_mode?: RouteWhenMode;
    ring_strategy?: RingStrategy;
    ring_timeout_seconds?: number;
    destination_type?: DestinationType;
    destination_external_number?: string | null;
    destination_route_id?: string | null;
    fallback_type?: FallbackType;
    fallback_external_number?: string | null;
    fallback_route_id?: string | null;
    callback_affinity_enabled?: boolean;
  } = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.numberId !== undefined) patch.number_id = input.numberId;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.whenMode !== undefined) patch.when_mode = input.whenMode;
  if (input.ringStrategy !== undefined) patch.ring_strategy = input.ringStrategy;
  if (input.ringTimeoutSeconds !== undefined) patch.ring_timeout_seconds = input.ringTimeoutSeconds;
  if (input.destinationType !== undefined) patch.destination_type = input.destinationType;
  if (input.destinationExternalNumber !== undefined) patch.destination_external_number = input.destinationExternalNumber;
  if (input.destinationRouteId !== undefined) patch.destination_route_id = input.destinationRouteId;
  if (input.fallbackType !== undefined) patch.fallback_type = input.fallbackType;
  if (input.fallbackExternalNumber !== undefined) patch.fallback_external_number = input.fallbackExternalNumber;
  if (input.fallbackRouteId !== undefined) patch.fallback_route_id = input.fallbackRouteId;
  if (input.callbackAffinityEnabled !== undefined) patch.callback_affinity_enabled = input.callbackAffinityEnabled;

  const { error } = await db
    .from('communication_routes')
    .update(patch)
    .eq('organization_id', input.organizationId)
    .eq('id', input.routeId);
  if (error) throw writeError(error);
}

/** Routes are disabled, never deleted — a call already placed through one must stay explainable. */
export async function setRouteEnabled(db: Db, input: { organizationId: string; routeId: string; enabled: boolean }): Promise<void> {
  await updateRoute(db, { organizationId: input.organizationId, routeId: input.routeId, enabled: input.enabled });
}

export async function listRouteTargets(
  db: Db,
  input: { organizationId: string; routeId: string },
): Promise<RouteTarget[]> {
  const { data, error } = await db
    .from('communication_route_targets')
    .select('id, route_id, slot, member_id, position')
    .eq('organization_id', input.organizationId)
    .eq('route_id', input.routeId)
    .order('slot', { ascending: true })
    .order('position', { ascending: true });
  if (error) throw new DomainError(error.message, 'routing.targets_failed');
  return (data ?? []).map((row) => ({ id: row.id, routeId: row.route_id, slot: row.slot as RouteTarget['slot'], memberId: row.member_id, position: row.position }));
}

/** Replaces one slot's whole ordered list — simpler and safer than diffing inserts/deletes/reorders for a handful of rows. */
export async function setRouteTargets(
  db: Db,
  input: { organizationId: string; routeId: string; slot: 'primary' | 'fallback'; memberIds: string[] },
): Promise<void> {
  const del = await db
    .from('communication_route_targets')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('route_id', input.routeId)
    .eq('slot', input.slot);
  if (del.error) throw writeError(del.error);

  if (input.memberIds.length === 0) return;

  const { error } = await db.from('communication_route_targets').insert(
    input.memberIds.map((memberId, position) => ({
      organization_id: input.organizationId,
      route_id: input.routeId,
      slot: input.slot,
      member_id: memberId,
      position,
    })),
  );
  if (error) throw writeError(error);
}
