import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import type { CallFilter } from '@/lib/domain/reception/calls';
import { shiftDate, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';

/**
 * The filters of the call history, written in the address so a filtered view can be linked to and
 * survives a reload. Every one is read by the database query behind the list; none narrows rows
 * that were fetched whole.
 */

type Query = Record<string, string | string[] | undefined>;

const DIRECTIONS = ['inbound', 'outbound'] as const;
const STATES = ['active', 'missed', 'completed'] as const;
const WHENS = ['today', 'week', 'month'] as const;

export type CallParams = {
  q?: string;
  direction?: (typeof DIRECTIONS)[number];
  state?: (typeof STATES)[number];
  when?: (typeof WHENS)[number];
  number?: string;
  member?: string;
  wrap?: '1';
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/** Anything in the address that is not a value this screen offers is ignored rather than trusted. */
export function parseCallParams(query: Query): { params: CallParams; cursor: string | null } {
  const params: CallParams = {};
  const search = first(query.q)?.slice(0, 100).trim();
  if (search) params.q = search;
  const direction = pick(first(query.direction), DIRECTIONS);
  const state = pick(first(query.state), STATES);
  const when = pick(first(query.when), WHENS);
  const number = first(query.number);
  const member = first(query.member);
  if (direction) params.direction = direction;
  if (state) params.state = state;
  if (when) params.when = when;
  if (number && /^[0-9a-f-]{36}$/.test(number)) params.number = number;
  if (member && /^[0-9a-f-]{36}$/.test(member)) params.member = member;
  if (first(query.wrap) === '1') params.wrap = '1';
  return { params, cursor: first(query.cursor) ?? null };
}

export function callFilterFromParams(params: CallParams, timeZone: string): CallFilter {
  const today = todayInZone(timeZone);
  const daysBack = params.when === 'week' ? 6 : params.when === 'month' ? 29 : 0;
  return {
    direction: params.direction,
    state: params.state,
    phoneNumberId: params.number,
    membershipId: params.member,
    needsWrapUp: params.wrap === '1',
    search: params.q,
    since: params.when ? zonedDayRange(shiftDate(today, -daysBack), timeZone).startsAt : undefined,
    until: params.when ? zonedDayRange(today, timeZone).endsAt : undefined,
  };
}

export function callsHref(base: string, params: CallParams, cursor?: string | null): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  if (cursor) search.set('cursor', cursor);
  const text = search.toString();
  return text ? `${base}?${text}` : base;
}

function Chip({ active, href, children }: { active: boolean; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${active ? 'border-accent bg-accent text-on-accent' : 'border-border hover:bg-hover'}`}
    >
      {children}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs text-subtle">{label}</span>
      {children}
    </div>
  );
}

export function CallFilters({
  base,
  params,
  numbers,
  members,
}: {
  base: string;
  params: CallParams;
  numbers: { id: string; e164: string; label: string | null }[];
  members: { id: string; displayName: string }[];
}) {
  const link = (change: Partial<Record<keyof CallParams, string | undefined>>) =>
    callsHref(base, { ...params, ...change } as CallParams);

  return (
    <div className="flex flex-col gap-2">
      <Group label="Direction">
        <Chip active={!params.direction} href={link({ direction: undefined })}>All</Chip>
        <Chip active={params.direction === 'inbound'} href={link({ direction: 'inbound' })}>Inbound</Chip>
        <Chip active={params.direction === 'outbound'} href={link({ direction: 'outbound' })}>Outbound</Chip>
      </Group>
      <Group label="State">
        <Chip active={!params.state} href={link({ state: undefined })}>Any</Chip>
        <Chip active={params.state === 'active'} href={link({ state: 'active' })}>Active</Chip>
        <Chip active={params.state === 'missed'} href={link({ state: 'missed' })}>Missed</Chip>
        <Chip active={params.state === 'completed'} href={link({ state: 'completed' })}>Completed</Chip>
        <Chip active={params.wrap === '1'} href={link({ wrap: params.wrap === '1' ? undefined : '1' })}>Needs wrap-up</Chip>
      </Group>
      <Group label="When">
        <Chip active={!params.when} href={link({ when: undefined })}>Any time</Chip>
        <Chip active={params.when === 'today'} href={link({ when: 'today' })}>Today</Chip>
        <Chip active={params.when === 'week'} href={link({ when: 'week' })}>7 days</Chip>
        <Chip active={params.when === 'month'} href={link({ when: 'month' })}>30 days</Chip>
      </Group>
      {numbers.length > 1 || members.length > 1 ? (
        <form method="get" action={base} className="flex flex-wrap items-center gap-2">
          {Object.entries(params)
            .filter(([key]) => key !== 'number' && key !== 'member')
            .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          {numbers.length > 1 ? (
            <SelectInput name="number" defaultValue={params.number ?? ''} aria-label="Number" size="small">
              <option value="">Every number</option>
              {numbers.map((number) => <option key={number.id} value={number.id}>{number.label ?? number.e164}</option>)}
            </SelectInput>
          ) : null}
          {members.length > 1 ? (
            <SelectInput name="member" defaultValue={params.member ?? ''} aria-label="Handled by" size="small">
              <option value="">Everyone</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
            </SelectInput>
          ) : null}
          <Button type="submit" tone="secondary" size="small">Apply</Button>
        </form>
      ) : null}
    </div>
  );
}
