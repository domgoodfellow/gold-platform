import { Badge } from '@/components/display/data';
import { cx } from '@/components/class-names';
import {
  allowanceResetsAt,
  type OrganizationAllowanceState,
} from '@/lib/domain/commercial/allowances';

/**
 * One resolved allowance, as a person reads it. Two callers: a business's own Plan & usage
 * screen, and the staff Commercial Account — so the arithmetic-free presentation lives here once
 * rather than being written twice and drifting (the one-calculation rule's reasoning, applied to a screen).
 *
 * **Nothing here computes a quantity.** Every number is one `app.allowance_states` already
 * resolved; this file decides only how to say it. The one calculation is the bar's own width,
 * which is a visual proportion and not an answer to "how much is left".
 *
 * **It says what is true, including when the truth is "we cannot tell".** An allowance nothing
 * counts shows what is included and declines to invent consumption; a window whose boundary could
 * not be established shows no reset date rather than a fabricated one.
 */

function formatQuantity(value: number): string {
  return value.toLocaleString('en-CA', { maximumFractionDigits: 2 });
}

const BYTE_UNITS: readonly { threshold: number; suffix: string }[] = [
  { threshold: 1_000_000_000_000, suffix: 'TB' },
  { threshold: 1_000_000_000, suffix: 'GB' },
  { threshold: 1_000_000, suffix: 'MB' },
  { threshold: 1_000, suffix: 'KB' },
];

/** A decimal byte count, scaled to the first unit it clears — "3.4 GB", never "3,400,000,000 byte". */
function formatBytes(value: number): string {
  const unit = BYTE_UNITS.find((candidate) => value >= candidate.threshold);
  if (!unit) return `${Math.round(value).toLocaleString('en-CA')} B`;
  return `${(value / unit.threshold).toLocaleString('en-CA', { maximumFractionDigits: 1 })} ${unit.suffix}`;
}

/**
 * A quantity with its unit, in the one place every unit this allowance engine carries gets read.
 * `byte` is the one unit a raw count is unreadable for; every other unit (minute, user, number,
 * segment…) is said exactly as the Plan named it.
 */
function formatQuantityWithUnit(value: number, unit: string): string {
  return unit === 'byte' ? formatBytes(value) : `${formatQuantity(value)} ${unit}`;
}

function formatResetDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

/** The proportion of the included quantity consumed, clamped for drawing. Not a stated number. */
function fillPercent(state: OrganizationAllowanceState): number {
  if (state.included === null || state.included <= 0 || state.consumed === null) return 0;
  return Math.min(100, Math.round((state.consumed / state.included) * 100));
}

export function AllowanceStateBadge({ state }: { state: OrganizationAllowanceState }) {
  switch (state.state) {
    case 'configuration_error':
      return <Badge tone="danger">Needs attention</Badge>;
    case 'hard_limit':
      return <Badge tone="danger">Limit reached</Badge>;
    case 'soft_limit':
      return <Badge>At the included limit</Badge>;
    default:
      return state.overageQuantity > 0 ? <Badge>Additional usage</Badge> : null;
  }
}

/**
 * What the window means for this allowance, in a phrase — or nothing at all. `basis` is carried
 * through from the resolver precisely so a Plan-anchored period is never shown as though a
 * payment processor had fixed it.
 */
export function AllowanceResetNote({ state }: { state: OrganizationAllowanceState }) {
  if (state.window.basis === 'unknown') {
    return <span className="text-subtle">The reset date is not known for this business yet</span>;
  }
  const resetsAt = allowanceResetsAt(state);
  if (!resetsAt) return null;
  return (
    <span className="text-subtle">
      Resets {formatResetDate(resetsAt)}
      {state.window.basis === 'subscription' ? ' with the next invoice' : ''}
    </span>
  );
}

export function AllowanceMeter({
  state,
  className,
}: {
  state: OrganizationAllowanceState;
  className?: string;
}) {
  const percent = fillPercent(state);
  const over = state.overageQuantity > 0;

  return (
    <div className={cx('py-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{state.label}</span>
        <AllowanceStateBadge state={state} />
      </div>

      {state.state === 'configuration_error' ? (
        <p className="mt-1 text-sm text-muted">
          {state.configurationError ?? 'This allowance can’t be shown right now.'}
        </p>
      ) : state.consumed === null || state.included === null ? (
        <>
          <p className="mt-1 text-sm tabular-nums">
            {state.included === null ? '—' : formatQuantityWithUnit(state.included, state.unit)} included
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            {state.enforcement === 'unenforced'
              ? 'GildOps does not yet measure this, so nothing is counted against it.'
              : 'Consumption is not available for this allowance.'}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm tabular-nums">
            {state.unit === 'byte'
              ? `${formatBytes(state.consumed)} / ${formatBytes(state.included)}`
              : `${formatQuantity(state.consumed)} / ${formatQuantity(state.included)} ${state.unit}`}
          </p>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
            role="presentation"
          >
            <div
              className={cx('h-full rounded-full', over ? 'bg-danger' : 'bg-accent')}
              style={{ width: `${Math.max(percent, state.consumed > 0 ? 2 : 0)}%` }}
            />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
            {over ? (
              <span className="text-muted tabular-nums">
                {formatQuantityWithUnit(state.overageQuantity, state.unit)} additional
                {state.overageBehavior === 'metered' ? ' · charged on top' : ''}
              </span>
            ) : (
              <span className="text-muted tabular-nums">
                {formatQuantityWithUnit(Math.max(state.remaining ?? 0, 0), state.unit)} remaining
              </span>
            )}
            <AllowanceResetNote state={state} />
          </p>
        </>
      )}
    </div>
  );
}
