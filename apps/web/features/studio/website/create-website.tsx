'use client';

import { useActionState } from 'react';
import type { SiteTemplate } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { createWebsiteAction, type WebsiteActionState } from '@/app/organizations/[organizationId]/studio/website/actions';

const INITIAL: WebsiteActionState = { error: null };

function Option({ organizationId, templateKey, name, description, detail, label, action, pending }: {
  organizationId: string; templateKey: string; name: string; description: string; detail: string; label: string;
  action: (formData: FormData) => void; pending: boolean;
}) {
  return (
    <li className="grid gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="grid gap-1">
        <p className="font-medium">{name}</p>
        <p className="text-sm text-muted">{description}</p>
        <p className="text-xs text-subtle">{detail}</p>
      </div>
      <form action={action}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="templateKey" value={templateKey} />
        <Button size="small" tone={templateKey ? 'secondary' : 'primary'} disabled={pending} aria-label={`${label}: ${name}`}>{label}</Button>
      </form>
    </li>
  );
}

/**
 * A business with no website creates its own: blank, or from a starter it then owns outright. This
 * needs no platform step and no hostname — it can be built, previewed and published long before an
 * address is connected.
 */
export function CreateWebsite({ organizationId, templates }: { organizationId: string; templates: SiteTemplate[] }) {
  const [state, action, pending] = useActionState(createWebsiteAction, INITIAL);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        You do not need an address yet: build the website, look at it privately, and connect an address when you are ready to publish.
      </p>
      <ErrorText>{state.error}</ErrorText>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Option
          organizationId={organizationId} templateKey="" name="Blank website"
          description="A homepage with nothing on it. Add the sections and pages you want."
          detail="1 page · no sections" label="Create blank website" action={action} pending={pending}
        />
        {templates.map((template) => (
          <Option
            key={template.key} organizationId={organizationId} templateKey={template.key} name={template.name}
            description={template.description}
            detail={`${template.pages.length} pages · ${template.pages.map((page) => page.name).join(', ')}`}
            label="Use template" action={action} pending={pending}
          />
        ))}
      </ul>
      {templates.length === 0 ? <Hint>No starter websites are available. Create a blank one instead.</Hint> : null}
    </div>
  );
}
