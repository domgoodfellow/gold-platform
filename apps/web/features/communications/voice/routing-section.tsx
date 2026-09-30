'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { DividedList, EmptyState, GroupHeading } from '@/components/surfaces/section';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  createRouteAction,
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

type Member = { id: string; displayName: string };
type NumberOption = { id: string; e164: string; label: string | null };

const DESTINATION_LABEL: Record<DestinationType, string> = {
  members: 'Team members',
  external_number: 'An external number',
  route: 'Another route',
};
const FALLBACK_LABEL: Record<FallbackType, string> = {
  voicemail: 'Voicemail',
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
                    {number ? (number.label ? `${number.e164} (${number.label})` : number.e164) : 'Organization default'}
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
        <SelectInput
          className="mt-2"
          size="small"
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...selected, event.target.value]);
          }}
        >
          <option value="">Add a member…</option>
          {available.map((member) => (
            <option key={member.id} value={member.id}>{member.displayName}</option>
          ))}
        </SelectInput>
      ) : null}
    </div>
  );
}

function RouteEditor({ organizationId, route, numbers, members, onDone }: {
  organizationId: string;
  route: Route | null;
  numbers: NumberOption[];
  members: Member[];
  onDone: () => void;
}) {
  const [name, setName] = useState(route?.name ?? '');
  const [numberId, setNumberId] = useState(route?.numberId ?? '');
  const [whenMode, setWhenMode] = useState<RouteWhenMode>(route?.whenMode ?? 'always');
  const [destinationType, setDestinationType] = useState<DestinationType>(route?.destinationType ?? 'members');
  const [ringStrategy, setRingStrategy] = useState<RingStrategy>(route?.ringStrategy ?? 'everyone');
  const [ringTimeoutSeconds, setRingTimeoutSeconds] = useState(route?.ringTimeoutSeconds ?? 20);
  const [destinationExternalNumber, setDestinationExternalNumber] = useState(route?.destinationExternalNumber ?? '');
  const [fallbackType, setFallbackType] = useState<FallbackType>(route?.fallbackType ?? 'voicemail');
  const [fallbackExternalNumber, setFallbackExternalNumber] = useState(route?.fallbackExternalNumber ?? '');
  const [callbackAffinityEnabled, setCallbackAffinityEnabled] = useState(route?.callbackAffinityEnabled ?? false);
  const [primaryMemberIds, setPrimaryMemberIds] = useState<string[]>([]);
  const [fallbackMemberIds, setFallbackMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RouteDecision | null>(null);
  const [previewNumber, setPreviewNumber] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const save = async () => {
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
      fallbackType,
      fallbackExternalNumber: fallbackType === 'external_number' ? fallbackExternalNumber : null,
      callbackAffinityEnabled,
      primaryMemberIds,
      fallbackMemberIds,
    };
    const result = route
      ? await updateRouteAction(organizationId, route.id, input)
      : await createRouteAction(organizationId, input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
  };

  const testRoute = async () => {
    setPreviewing(true);
    const result = await previewInboundRouteAction(organizationId, { numberId: numberId || null, fromNumber: previewNumber || null });
    setPreviewing(false);
    if (result.ok) setPreview(result.data);
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
        <SelectInput id="route-number" className="mt-1" value={numberId} onChange={(event) => setNumberId(event.target.value)}>
          <option value="">Organization default</option>
          {numbers.map((number) => (
            <option key={number.id} value={number.id}>{number.label ? `${number.e164} (${number.label})` : number.e164}</option>
          ))}
        </SelectInput>
      </div>

      <div>
        <FieldLabel htmlFor="route-when">When</FieldLabel>
        <SelectInput id="route-when" className="mt-1" value={whenMode} onChange={(event) => setWhenMode(event.target.value as RouteWhenMode)}>
          <option value="always">Always</option>
          <option value="business_hours">Business hours</option>
        </SelectInput>
      </div>

      <div>
        <FieldLabel htmlFor="route-destination">Send to</FieldLabel>
        <SelectInput id="route-destination" className="mt-1" value={destinationType} onChange={(event) => setDestinationType(event.target.value as DestinationType)}>
          <option value="members">Team members</option>
          <option value="external_number">An external number</option>
        </SelectInput>
      </div>

      {destinationType === 'members' ? (
        <>
          <div>
            <FieldLabel htmlFor="route-ring">Ring</FieldLabel>
            <SelectInput id="route-ring" className="mt-1" value={ringStrategy} onChange={(event) => setRingStrategy(event.target.value as RingStrategy)}>
              <option value="everyone">Everyone</option>
              <option value="sequential">Sequential</option>
              <option value="round_robin">Round robin</option>
            </SelectInput>
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
      ) : (
        <div>
          <FieldLabel htmlFor="route-external">Number</FieldLabel>
          <TextInput id="route-external" type="tel" className="mt-1" placeholder="+14165550142" value={destinationExternalNumber}
            onChange={(event) => setDestinationExternalNumber(event.target.value)} />
        </div>
      )}

      <div>
        <FieldLabel htmlFor="route-fallback">If unanswered</FieldLabel>
        <SelectInput id="route-fallback" className="mt-1" value={fallbackType} onChange={(event) => setFallbackType(event.target.value as FallbackType)}>
          <option value="voicemail">Voicemail</option>
          <option value="members">Team members</option>
          <option value="external_number">An external number</option>
          <option value="none">Nothing — the call ends</option>
        </SelectInput>
      </div>
      {fallbackType === 'members' ? (
        <OrderedMemberPicker label="Fallback to" members={members} selected={fallbackMemberIds} onChange={setFallbackMemberIds} />
      ) : null}
      {fallbackType === 'external_number' ? (
        <TextInput type="tel" placeholder="+14165550142" value={fallbackExternalNumber} onChange={(event) => setFallbackExternalNumber(event.target.value)} />
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={saving || !name}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button type="button" tone="secondary" onClick={onDone}>Cancel</Button>
        {route ? (
          <Button
            type="button"
            tone="secondary"
            onClick={() => setRouteEnabledAction(organizationId, { routeId: route.id, enabled: !route.enabled }).then(onDone)}
          >
            {route.enabled ? 'Disable' : 'Enable'}
          </Button>
        ) : null}
      </div>

      <div className="border-t border-border pt-4">
        <GroupHeading>Test route</GroupHeading>
        <div className="mt-2 flex items-center gap-2">
          <TextInput placeholder="+14165558821" size="small" value={previewNumber} onChange={(event) => setPreviewNumber(event.target.value)} className="w-40" />
          <Button type="button" tone="secondary" size="small" onClick={testRoute} disabled={previewing}>Test route</Button>
        </div>
        {preview ? (
          <div className="mt-2 text-sm">
            <Badge tone={status.tone}>{status.label}</Badge>{' '}
            <span className="text-muted">{REASON_LABEL[preview.reason] ?? preview.reason}</span>
            {preview.memberIds.length > 0 ? (
              <div className="mt-1">{preview.memberIds.map((id) => members.find((member) => member.id === id)?.displayName ?? id).join(', ')}</div>
            ) : null}
            {preview.externalNumber ? <div className="mt-1">{preview.externalNumber}</div> : null}
            {preview.warnings.map((warning) => <Hint key={warning} className="mt-1">{warning}</Hint>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
