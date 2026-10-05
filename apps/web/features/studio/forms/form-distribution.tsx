'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/controls/button';
import { CopyField } from '@/components/controls/copy-field';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { GroupHeading } from '@/components/surfaces/section';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { embedSnippet, placementLabels, publicFormPath, stableFormPath, type FormPlacements } from '@/lib/domain/forms/forms';
import { setPortalFormAction } from '@/app/organizations/[organizationId]/studio/forms/actions';

/**
 * Where a published form can be put, and where it already is. Secondary to authoring on purpose:
 * one button in the toolbar opens this, so the builder is not a row of tabs. Nothing here is
 * infrastructure — the business is placing a form, not learning how it is routed.
 *
 * The form is never copied into a place. The website names it, the portal lists it, and a link or an
 * embed opens it; each owner keeps its own reference, and this panel only asks them.
 */
export function FormDistribution({ organizationId, formId, formSlug, publicKey, organizationSlug, siteHostname, origin, published, placements }: {
  organizationId: string;
  formId: string;
  formSlug: string;
  publicKey: string;
  organizationSlug: string | null;
  /** The business's own address for its website, when it has one that resolves. */
  siteHostname: string | null;
  origin: string;
  published: boolean;
  placements: FormPlacements;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const used = placementLabels(placements);

  const togglePortal = () => {
    setError(null);
    startTransition(async () => {
      const result = await setPortalFormAction({ organizationId, formId, enabled: !placements.portal });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button tone="secondary" size="small">Distribute</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Distribute</PageDrawerTitle></PageDrawerHeader>
        <div className="grid gap-6 text-sm">
          {!published ? <Hint>Publish this form to share it. Links and embeds open the published version only.</Hint> : null}

          <section className="grid gap-2" aria-label="Link">
            <GroupHeading>Link</GroupHeading>
            <CopyField label="Form link" value={`${origin}${stableFormPath(publicKey)}`} />
            <Hint>This link keeps working if you rename the form or your business.</Hint>
            {organizationSlug ? <CopyField label="Readable form link" value={`${origin}${publicFormPath(organizationSlug, formSlug)}`} size="small" /> : null}
            {siteHostname ? <CopyField label="Form link on your site" value={`https://${siteHostname}/forms/${formSlug}`} size="small" /> : null}
          </section>

          <section className="grid gap-2" aria-label="Website">
            <GroupHeading>Website</GroupHeading>
            <p>{placements.websitePublished ? 'Shown on your published website.' : placements.websiteDraft ? 'Added to a website draft that is not published yet.' : 'Not on your website.'}</p>
            <div>
              <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/studio/website`}>
                {placements.websitePublished || placements.websiteDraft ? 'Open website' : 'Add to website'}
              </ButtonLink>
            </div>
          </section>

          <section className="grid gap-2" aria-label="Portal">
            <GroupHeading>Customer portal</GroupHeading>
            <p>{placements.portal ? 'Offered to customers in their portal.' : 'Not offered in the portal.'}</p>
            <div><Button tone="secondary" size="small" disabled={pending} onClick={togglePortal}>{placements.portal ? 'Remove from portal' : 'Add to portal'}</Button></div>
          </section>

          <section className="grid gap-2" aria-label="Embed">
            <GroupHeading>Embed on another site</GroupHeading>
            <CopyField label="Embed code" value={embedSnippet(origin, publicKey)} mono size="small" copiedMessage="Embed code copied" />
            <Hint>Paste it where the form should appear. It shows only the published form.</Hint>
          </section>

          <section className="grid gap-1" aria-label="Used by">
            <GroupHeading>Used by</GroupHeading>
            <p>{used.length > 0 ? used.join(', ') : 'Nowhere yet.'}</p>
            {used.length > 0 ? <Hint>Remove a form from these places before archiving it.</Hint> : null}
          </section>

          <ErrorText role="alert">{error}</ErrorText>
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
