import Link from 'next/link';
import type { SetupOverview } from '@/lib/domain/tenancy/lifecycle';

/**
 * Setup as contextual onboarding status on organization Home, never a permanent navigation category.
 * The counts come from `computeSetupOverview` — required blockers only, so unfinished recommended or
 * optional areas never read as "not ready to launch". Whoever cannot launch sees the same facts as
 * information with no instruction to act; the Setup page and `launchOrganization` still enforce both.
 */
export function SetupBanner({
  organizationId,
  overview,
  mayLaunch,
}: {
  organizationId: string;
  overview: SetupOverview | null;
  mayLaunch: boolean;
}) {
  const setupHref = `/organizations/${organizationId}/setup`;

  if (!overview) {
    return (
      <Banner state="unavailable" title="Setup status is unavailable" detail="Open setup to see the current checklist." action="Review setup" href={setupHref} />
    );
  }

  const required = overview.blockers.length;
  if (required > 0) {
    const remaining = `${required} required ${required === 1 ? 'step remains' : 'steps remain'} before launch.`;
    return mayLaunch ? (
      <Banner state="required" title={`Setup required — ${remaining}`} detail="Complete the required steps, then launch when every one is finished." action="Review setup" href={setupHref} />
    ) : (
      <Banner state="pending" title="Setup in progress" detail={`${remaining} An organization manager can finish setup.`} action="View setup" href={setupHref} />
    );
  }

  return mayLaunch ? (
    <Banner state="ready" title="Ready to launch" detail="Required setup is complete. Review the checklist, then launch when you are ready." action="Review and launch" href={setupHref} />
  ) : (
    <Banner state="pending" title="Ready to launch" detail="Required setup is complete. An organization manager can launch this business." action="View setup" href={setupHref} />
  );
}

function Banner({
  state,
  title,
  detail,
  action,
  href,
}: {
  state: 'required' | 'ready' | 'pending' | 'unavailable';
  title: string;
  detail: string;
  action: string;
  href: string;
}) {
  return (
    <section aria-label="Organization setup" data-state={state} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{detail}</p>
      </div>
      <Link href={href} className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-hover md:min-h-8">
        {action}
      </Link>
    </section>
  );
}
