import { Button } from '@/components/controls/button';
import type { FeasibilityView } from '@/features/scheduling/feasibility-text';

/**
 * What the check said, in words. The verdict is text first — "Feasible" / "Not feasible" — so it
 * reads the same without colour, and it is a live region so a screen reader hears it appear. The
 * suggestion is only ever offered, never applied: ticking the boxes is the operator's act.
 */
export function FeasibilityPanel({
  view,
  onUseSuggested,
}: {
  view: FeasibilityView;
  onUseSuggested?: (ids: string[]) => void;
}) {
  const showSuggestion = view.feasible && view.suggestedIds.length > 0;

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">
        <span aria-hidden>{view.feasible ? '✓ ' : '! '}</span>
        {view.summary}
      </p>

      {showSuggestion ? (
        <div className="flex flex-col gap-1">
          <p>
            <span className="text-muted">Suggested: </span>
            {view.suggestedNames.join(', ')}
          </p>
          {onUseSuggested ? (
            <div>
              <Button type="button" tone="secondary" size="small" onClick={() => onUseSuggested(view.suggestedIds)}>
                Use suggested resources
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {view.reasons.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {view.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {view.selection ? (
        <div className="flex flex-col gap-0.5 border-t border-border pt-2">
          <p className="font-medium">
            {view.selection.ok ? 'The resources you ticked cover everything and are all available.' : 'The resources you ticked:'}
          </p>
          {view.selection.lines.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {view.selection.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
