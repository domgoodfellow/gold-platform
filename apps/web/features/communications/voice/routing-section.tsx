'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { DividedList, EmptyState, GroupHeading } from '@/components/surfaces/section';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import {
  createRouteAction,
  readRouteTargetsAction,
  previewInboundRouteAction,
  setRouteEnabledAction,
  updateRouteAction,
} from '@/app/organizations/[organizationId]/calls/routing-actions';
import type { RouteDecision } from '@/lib/api/routing';
import type {
  DestinationType,
  FallbackType,
  RingStrategy,
  Route,
  RouteWhenMode,
} from '@/lib/domain/reception/routing';
import { SelectField } from '@/components/controls/select-field';

type Member = { id: string; displayName: string };
type NumberOption = { id: string; e164: string; label: string | null };

const DESTINATION_LABEL: Record<DestinationType, string> = {
  ai_receptionist: 'AI receptionist',
  members: 'Team members',
  external_number: 'An external number',
  route: 'Another route',
};
const FALLBACK_LABEL: Record<FallbackType, string> = {
  voicemail: 'Message, then end',
  members: 'Team members',
  external_number: 'An external number',
  route: 'Another route',
  none: 'Nothing — the call ends',
};
const REASON_LABEL: Record<string, string> = {
  no_route: 'No destination',
  route_disabled: 'Disabled',
  outside_business_hours: 'After hours',
  destination_external_number: 'Active',
  primary_destination: 'Active',
  callback_affinity: 'Active — returning to last agent',
  no_eligible_destination: 'Needs attention',
  route_loop: 'Needs attention',
  destination_route_missing: 'Needs attention',
};

function statusFor(decision: RouteDecision | null): { label: string; tone: 'success' | 'neutral' | 'danger' } {
  if (!decision) return { label: '—', tone: 'neutral' };
  if (!decision.matched) return { label: 'No destination', tone: 'neutral' };
  if (decision.reason === 'route_disabled') return { label: 'Disabled', tone: 'neutral' };
  if (['no_eligible_destination', 'route_loop', 'destination_route_missing'].includes(decision.reason)) {
    return { label: 'Needs attention', tone: 'danger' };
  }
  if (decision.reason === 'outside_business_hours') return { label: 'After hours', tone: 'neutral' };
  return { label: 'Active', tone: 'success' };
}

/** The Configure → Routing surface: a compact route list and one editor at a time. */
export function RoutingSection({
  organizationId,
  routes,
  numbers,
  members,
}: {
  organizationId: string;
  routes: Route[];
  numbers: NumberOption[];
  members: Member[];
}) {
  const [editing, setEditing] = useState<Route | 'new' | null>(null);

  if (editing) {
    return (
      <RouteEditor
        organizationId={organizationId}
        route={editing === 'new' ? null : editing}
        numbers={numbers}
        members={members}
        routes={routes}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      {routes.length === 0 ? (
        <EmptyState className="mt-2">No inbound routes yet.</EmptyState>
      ) : (
        <DividedList className="mt-2">
          {routes.map((route) => {
            const number = numbers.find((candidate) => candidate.id === route.numberId);
            return (
              <li key={route.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{route.name}</span>
                    {!route.enabled ? <Badge>Disabled</Badge> : null}
                  </div>
                  <div className="text-sm text-muted">
                    {number ? (number.label ? `${formatPhoneForDisplay(number.e164)} (${number.label})` : formatPhoneForDisplay(number.e164)) : 'Organization default'}
                    {' · '}
                    {DESTINATION_LABEL[route.destinationType]}
                    {route.destinationType === 'members' ? ` · ${route.ringStrategy === 'everyone' ? 'Everyone' : route.ringStrategy === 'sequential' ? 'Sequential' : 'Round robin'}` : ''}
                    {' → '}
                    {FALLBACK_LABEL[route.fallbackType]}
                  </div>
                </div>
                <Button type="button" tone="secondary" size="small" onClick={() => setEditing(route)}>
                  Edit
                </Button>
              </li>
            );
          })}
        </DividedList>
      )}
      <div className="mt-3">
        <Button type="button" tone="secondary" size="small" onClick={() => setEditing('new')}>
          Add route
        </Button>
      </div>
    </div>
  );
}

function OrderedMemberPicker({ label, members, selected, onChange }: {
  label: string;
  members: Member[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const available = members.filter((member) => !selected.includes(member.id));
  const name = (id: string) => members.find((member) => member.id === id)?.displayName ?? id;

  return (
    <div>
      <GroupHeading>{label}</GroupHeading>
      {selected.length === 0 ? (
        <Hint className="mt-1">Nobody added yet.</Hint>
      ) : (
        <ol className="mt-1 space-y-1">
          {selected.map((memberId, index) => (
            <li key={memberId} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-subtle">{index + 1}</span>
              <span className="flex-1">{name(memberId)}</span>
              <Button type="button" tone="text" size="tiny" disabled={index === 0} aria-label="Move up" onClick={() => {
                const next = [...selected];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}>
                <ChevronUp aria-hidden />
              </Button>
              <Button type="button" tone="text" size="tiny" disabled={index === selected.length - 1} aria-label="Move down" onClick={() => {
                const next = [...selected];
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                onChange(next);
              }}>
                <ChevronDown aria-hidden />
              </Button>
              <Button type="button" tone="text" size="tiny" aria-label="Remove" onClick={() => onChange(selected.filter((id) => id !== memberId))}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {available.length > 0 ? (
        <SelectField className="mt-2" size="small" value="" onValueChange={(next) => {
            if (next) onChange([...selected, next]);
          }} options={[{ value: '', label: 'Add a member…' }, ...available.map((member) => ({ value: member.id, label: member.displayName }))]} />
      ) : null}
    </div>
  );
}

function RouteEditor({ organizationId, route, numbers, members, routes, onDone }: {
  organizationId: string;
  route: Route | null;
  numbers: NumberOption[];
  members: Member[];
  routes: Route[];
  onDone: () => void;
}) {
  const [name, setName] = useState(route?.name ?? '');
  const [numberId, setNumberId] = useState(route?.numberId ?? '');
  const [whenMode, setWhenMode] = useState<RouteWhenMode>(route?.whenMode ?? 'always');
  const [destinationType, setDestinationType] = useState<DestinationType>(route?.destinationType ?? 'members');
  const [ringStrategy, setRingStrategy] = useState<RingStrategy>(route?.ringStrategy ?? 'everyone');
  const [ringTimeoutSeconds, setRingTimeoutSeconds] = useState(route?.ringTimeoutSeconds ?? 20);
  const [destinationExternalNumber, setDestinationExternalNumber] = useState(route?.destinationExternalNumber ?? '');
  const [fallbackMessage, setFallbackMessage] = useState(route?.fallbackMessage ?? '');
  const [fallbackType, setFallbackType] = useState<FallbackType>(route?.fallbackType ?? 'voicemail');
  const [fallbackExternalNumber, setFallbackExternalNumber] = useState(route?.fallbackExternalNumber ?? '');
  const [callbackAffinityEnabled, setCallbackAffinityEnabled] = useState(route?.callbackAffinityEnabled ?? false);
  const [primaryMemberIds, setPrimaryMemberIds] = useState<string[]>([]);
  const [fallbackMemberIds, setFallbackMemberIds] = useState<string[]>([]);
  const [targetsLoaded, setTargetsLoaded] = useState(!route);
  const [destinationRouteId, setDestinationRouteId] = useState(route?.destinationRouteId ?? '');
  const [fallbackRouteId, setFallbackRouteId] = useState(route?.fallbackRouteId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RouteDecision | null>(null);
  const [previewNumber, setPreviewNumber] = useState('');
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    readRouteTargetsAction(organizationId, route.id).then(result => {
      if (cancelled) return;
      if (!result.ok) { setError(result.error); return; }
      setPrimaryMemberIds(result.data.filter(target => target.slot === 'primary').map(target => target.memberId));
      setFallbackMemberIds(result.data.filter(target => target.slot === 'fallback').map(target => target.memberId));
      setTargetsLoaded(true);
    }).catch(() => { if (!cancelled) setError('Could not load saved route members. Close and reopen this editor to retry.'); });
    return () => { cancelled = true; };
  }, [organizationId, route]);

  const save = async () => {
    if (!targetsLoaded) return;
    setSaving(true);
    setError(null);
    const input = {
      name,
      numberId: numberId || null,
      whenMode,
      ringStrategy,
      ringTimeoutSeconds,
      destinationType,
      destinationExternalNumber: destinationType === 'external_number' ? destinationExternalNumber : null,
      destinationRouteId: destinationType === 'route' ? destinationRouteId || null : null,
      fallbackType,
      fallbackMessage: fallbackMessage || null,
      fallbackExternalNumber: fallbackType === 'external_number' ? fallbackExternalNumber : null,
      fallbackRouteId: fallbackType === 'route' ? fallbackRouteId || null : null,
      callbackAffinityEnabled,
      primaryMemberIds,
      fallbackMemberIds,
    };
    try {
      const result = route
        ? await updateRouteAction(organizationId, route.id, input)
        : await createRouteAction(organizationId, input);
      if (!result.ok) { setError(result.error); return; }
      onDone();
    } catch { setError('Could not save this route. Try again.'); }
    finally { setSaving(false); }
  };

  const testRoute = async () => {
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const result = await previewInboundRouteAction(organizationId, { numberId: numberId || null, fromNumber: previewNumber || null });
      if (result.ok) setPreview(result.data); else setError(result.error);
    } catch { setError('Routing preview could not be reached. Try again.'); }
    finally { setPreviewing(false); }
  };

  const status = statusFor(preview);

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="route-name">Route</FieldLabel>
        <TextInput id="route-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sales inbound" className="mt-1" />
      </div>

      <div>
        <FieldLabel htmlFor="route-number">Number</FieldLabel>
        <SelectField id="route-number" className="mt-1" value={numberId} onValueChange={(next) => setNumberId(next)} options={[{ value: '', label: 'Organization default' }, ...numbers.map((number) => ({ value: number.id, label: number.label ? `${formatPhoneForDisplay(number.e164)} (${number.label})` : formatPhoneForDisplay(number.e164) }))]} />
      </div>

      <div>
        <FieldLabel htmlFor="route-when">When</FieldLabel>
        <SelectField id="route-when" className="mt-1" value={whenMode} onValueChange={(next) => setWhenMode(next as RouteWhenMode)} options={[{ value: 'always', label: 'Always' }, { value: 'business_hours', label: 'Business hours' }]} />
      </div>

      <div>
        <FieldLabel htmlFor="route-destination">Send to</FieldLabel>
        <SelectField id="route-destination" className="mt-1" value={destinationType} onValueChange={(next) => setDestinationType(next as DestinationType)} options={[{ value: 'ai_receptionist', label: 'AI receptionist' }, { value: 'members', label: 'Team members' }, { value: 'external_number', label: 'An external number' }, { value: 'route', label: 'Another route' }]} />
      </div>

      {destinationType === 'members' ? (
        <>
          <div>
            <FieldLabel htmlFor="route-ring">Ring</FieldLabel>
            <SelectField id="route-ring" className="mt-1" value={ringStrategy} onValueChange={(next) => setRingStrategy(next as RingStrategy)} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'sequential', label: 'Sequential' }, { value: 'round_robin', label: 'Round robin' }]} />
          </div>
          {ringStrategy !== 'everyone' ? (
            <OrderedMemberPicker label="Order" members={members} selected={primaryMemberIds} onChange={setPrimaryMemberIds} />
          ) : (
            <OrderedMemberPicker label="Who" members={members} selected={primaryMemberIds} onChange={setPrimaryMemberIds} />
          )}
          <div>
            <FieldLabel htmlFor="route-timeout">Ring for</FieldLabel>
            <TextInput id="route-timeout" type="number" min={5} max={120} className="mt-1 w-24" value={ringTimeoutSeconds}
              onChange={(event) => setRingTimeoutSeconds(Number(event.target.value))} /> <span className="text-sm text-muted">seconds</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={callbackAffinityEnabled} onChange={(event) => setCallbackAffinityEnabled(event.target.checked)} />
            Return calls to the last agent
          </label>
        </>
      ) : destinationType === 'external_number' ? (
        <div>
          <FieldLabel htmlFor="route-external">Number</FieldLabel>
          <PhoneInput id="route-external" type="tel" className="mt-1" placeholder="+14165550142" value={destinationExternalNumber}
            onChange={(event) => setDestinationExternalNumber(event.target.value)} />
        </div>
      ) : destinationType === 'ai_receptionist' ? <Hint>Needs a receptionist that is on and budget below. Otherwise this route uses its fallback.</Hint> : <SelectField aria-label="Destination route" value={destinationRouteId} onValueChange={(next) => setDestinationRouteId(next)} options={[{ value: '', label: 'Choose route' }, ...routes.filter(candidate => candidate.id !== route?.id).map((candidate) => ({ value: candidate.id, label: candidate.name }))]} />}

      <div>
        <FieldLabel htmlFor="route-fallback">If unanswered</FieldLabel>
        <SelectField id="route-fallback" className="mt-1" value={fallbackType} onValueChange={(next) => setFallbackType(next as FallbackType)} options={[{ value: 'voicemail', label: 'Message, then end' }, { value: 'members', label: 'Team members' }, { value: 'external_number', label: 'An external number' }, { value: 'none', label: 'Nothing — the call ends' }, { value: 'route', label: 'Another route' }]} />
      </div>
      {fallbackType === 'voicemail' ? <div><FieldLabel htmlFor="fallback-message">Message before ending</FieldLabel><TextInput id="fallback-message" maxLength={2000} value={fallbackMessage} onChange={event => setFallbackMessage(event.target.value)} /><Hint>No recording is collected. An empty message ends the call.</Hint></div> : null}
      {fallbackType === 'members' ? (
        <OrderedMemberPicker label="Fallback to" members={members} selected={fallbackMemberIds} onChange={setFallbackMemberIds} />
      ) : null}
      {fallbackType === 'external_number' ? (
        <PhoneInput type="tel" placeholder="+14165550142" value={fallbackExternalNumber} onChange={(event) => setFallbackExternalNumber(event.target.value)} />
      ) : null}
      {fallbackType === 'route' ? <SelectField aria-label="Fallback route" value={fallbackRouteId} onValueChange={(next) => setFallbackRouteId(next)} options={[{ value: '', label: 'Choose route' }, ...routes.filter(candidate => candidate.id !== route?.id).map((candidate) => ({ value: candidate.id, label: candidate.name }))]} /> : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={saving || !name || !targetsLoaded}>{saving ? 'Saving…' : !targetsLoaded ? 'Loading saved members…' : 'Save'}</Button>
        <Button type="button" tone="secondary" onClick={onDone}>Cancel</Button>
        {route ? (
          <Button
            type="button"
            tone="secondary"
            onClick={async () => {
              setError(null);
              try {
                const result = await setRouteEnabledAction(organizationId, { routeId: route.id, enabled: !route.enabled });
                if (result.ok) onDone(); else setError(result.error);
              } catch { setError('Could not change this route. Try again.'); }
            }}
          >
            {route.enabled ? 'Disable' : 'Enable'}
          </Button>
        ) : null}
      </div>

      <div className="border-t border-border pt-4">
        <GroupHeading>Test route</GroupHeading>
        <Hint className="mt-1">Tests saved routing for the selected number. Save changes before testing.</Hint>
        <div className="mt-2 flex items-center gap-2">
          <PhoneInput aria-label="Routing test caller number" placeholder="+14165558821" size="small" value={previewNumber} onChange={(event) => setPreviewNumber(event.target.value)} className="w-40" />
          <Button type="button" tone="secondary" size="small" onClick={testRoute} disabled={previewing}>Test route</Button>
        </div>
        {preview ? (
          <div className="mt-2 text-sm">
            <Badge tone={status.tone}>{status.label}</Badge>{' '}
            <span className="text-muted">{REASON_LABEL[preview.reason] ?? preview.reason}</span>
            {preview.memberIds.length > 0 ? (
              <div className="mt-1">{preview.memberIds.map((id) => members.find((member) => member.id === id)?.displayName ?? id).join(', ')}</div>
            ) : null}
            {preview.externalNumber ? <div className="mt-1">{formatPhoneForDisplay(preview.externalNumber)}</div> : null}
            {preview.warnings.map((warning) => <Hint key={warning} className="mt-1">{warning}</Hint>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
