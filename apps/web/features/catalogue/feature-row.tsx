'use client';

import { useActionState, useState } from 'react';
import { Badge } from '@/components/display/data';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/controls/confirm-submit';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@gold/ui/components/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { featureOperationalState, isOperationalFeature, type FeatureOperationalState } from '@/lib/domain/catalogue/feature-operational-state';
import { setFeatureActivationAction } from '@/app/organizations/[organizationId]/settings/actions';

const STATUS_LABEL: Record<OperationalFeatureState, string> = {
  ready: 'On',
  setup_required: 'Needs setup',
  disabled: 'Disabled',
};

type OperationalFeatureState = Extract<FeatureOperationalState, 'ready' | 'setup_required' | 'disabled'>;

/**
 * One operational Feature, resolved: something this business can use, set up or switch off.
 * Never computes entitlement, activation or readiness itself — every fact here is
 * `organizationResolvedFeatureStates`'s, classified once by `featureOperationalState`.
 */
export function FeatureRow({
  organizationId,
  label,
  description,
  state,
  mayManage,
  mayConfigure = true,
  meta,
  showReason = true,
}: {
  organizationId: string;
  label: string;
  description: string;
  state: ResolvedFeatureState;
  /** A short locating word shown beside the status, e.g. the feature's module. */
  meta?: string;
  /** False when the setup reason is already said once for the whole group. */
  showReason?: boolean;
  /** Gated on `feature.manage`, never on `organization.manage` — a distinct capability now that one exists. */
  mayManage: boolean;
  mayConfigure?: boolean;
}) {
  const [actionState, formAction, pending] = useActionState(setFeatureActivationAction, {
    error: null,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const operational = featureOperationalState(state);
  if (!isOperationalFeature(operational)) return null;
  const disabled = operational === 'disabled';
  const status = STATUS_LABEL[operational as OperationalFeatureState];

  return (
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          {label}
          <Badge className="font-normal">{status}</Badge>
          {meta ? <span className="text-xs font-normal text-muted">{meta}</span> : null}
        </p>
        <Hint className="mt-0.5 text-xs">{description}</Hint>
        {showReason && operational === 'setup_required' && state.reason ? (
          <p className="mt-1 text-sm text-muted">{state.reason}</p>
        ) : null}
        <ErrorText role="alert" className="mt-1">{actionState.error}</ErrorText>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!disabled && mayConfigure && state.primaryHref ? (
          <ButtonLink
            href={operational === 'setup_required' ? (state.setupHref ?? state.primaryHref) : state.primaryHref}
            tone="secondary"
            size="small"
          >
            {operational === 'setup_required' ? 'Set up' : 'Open'}
          </ButtonLink>
        ) : null}

        {mayManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" tone="secondary" size="small" aria-label={`More actions for ${label}`}>
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {disabled ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    const form = document.getElementById(
                      `feature-activation-${state.featureId}`,
                    ) as HTMLFormElement | null;
                    form?.requestSubmit();
                  }}
                >
                  Enable feature
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    setConfirmOpen(true);
                  }}
                >
                  Disable feature
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <form id={`feature-activation-${state.featureId}`} action={formAction} className="hidden">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="featureId" value={state.featureId} />
          <input type="hidden" name="enabled" value={disabled ? '1' : '0'} />
        </form>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disable {label}?</DialogTitle>
              <DialogDescription>
                This surface becomes unavailable to this business. Nothing it has already
                recorded or configured here is removed, and re-enabling restores access
                exactly as it was.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" tone="secondary" size="small">Cancel</Button>
              </DialogClose>
              <Button
                type="submit"
                form={`feature-activation-${state.featureId}`}
                tone="danger"
                size="small"
                disabled={pending}
                // Deferred: closing this dialog is what unmounts this very button, and a
                // same-tick state update can remove it from the DOM before the browser gets
                // to run the click's native default action — the `type="submit"`/`form=`
                // cross-boundary submission this button exists for. A macrotask lets that
                // default action run first; the dialog still closes immediately to the eye.
                onClick={() => setTimeout(() => setConfirmOpen(false), 0)}
              >
                {pending ? '…' : 'Disable feature'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
