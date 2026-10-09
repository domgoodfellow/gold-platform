'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText, Hint } from '@/components/controls/inputs';
import {
  removeLogoAction,
  uploadLogoAction,
  type BrandState,
} from '@/app/organizations/[organizationId]/settings/actions';
import { LOGO_MAX_BYTES, LOGO_TYPES } from '@/lib/domain/branding/logo-rules';

const INITIAL: BrandState = { error: null };

/**
 * A logo, and taking it down again. Its own forms, not fields on the appearance form: the bytes
 * go up on their own, so a colour change can never clear or re-upload a logo. The limits are the
 * domain's own (`logo-rules`) and are checked again on the server.
 */
export function LogoControls({
  organizationId,
  logoUrl,
  name,
  readOnly,
}: {
  organizationId: string;
  logoUrl: string | null;
  name: string;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(uploadLogoAction, INITIAL);
  const [removeState, removeAction, removing] = useActionState(removeLogoAction, INITIAL);
  const [fileError, setFileError] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="logo-heading">
      <h2 id="logo-heading" className="text-sm font-medium">
        Logo
      </h2>
      <div className="flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
          {logoUrl ? (
            // A tenant's own upload in a public bucket, not a build-time asset.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Current logo" className="max-h-12 max-w-12 object-contain" />
          ) : (
            <span aria-hidden className="text-xl font-semibold">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        {readOnly ? null : (
          <div className="flex min-w-0 flex-col gap-2">
            <form
              action={formAction}
              onSubmit={(event) => {
                const file = new FormData(event.currentTarget).get('logo');
                if (file instanceof File && file.size > LOGO_MAX_BYTES) {
                  event.preventDefault();
                  setFileError('A logo is at most 2 MB.');
                }
              }}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <input
                name="logo"
                type="file"
                required
                aria-label={logoUrl ? 'Choose a replacement logo' : 'Choose a logo'}
                accept={LOGO_TYPES.join(',')}
                onChange={() => setFileError(null)}
                className="max-w-full text-sm"
              />
              <Button type="submit" size="small" tone="secondary" disabled={pending} className="w-fit">
                {pending ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
              </Button>
            </form>
            {logoUrl ? (
              <form id="remove-logo" action={removeAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <ConfirmSubmit
                  formId="remove-logo"
                  label="Remove logo"
                  confirmLabel="Remove logo"
                  description="Remove your logo? Public pages fall back to your business name."
                  tone="danger"
                  size="small"
                  pending={removing}
                />
              </form>
            ) : null}
          </div>
        )}
      </div>
      <Hint weight="subtle">
        PNG, JPEG, SVG or WebP, up to 2 MB. A square mark works best. It appears in the sidebar and
        at the top of public pages, on a public address. Without one, your business initial is
        shown.
      </Hint>
      <ErrorText role="alert">{fileError || state.error || removeState.error}</ErrorText>
    </section>
  );
}
