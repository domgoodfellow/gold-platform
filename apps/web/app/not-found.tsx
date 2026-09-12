import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { PageHeading } from '@/components/containers/section';
import { SiteShell } from '@/components/containers/site-shell';

export default function NotFound() {
  return (
    <SiteShell>
      <div className="flex flex-1 flex-col items-start justify-center gap-4">
        <p className="font-mono text-sm text-subtle">404</p>
        <PageHeading>This page does not exist.</PageHeading>
        <p className="max-w-md text-muted">
          The address may have changed, or the page may no longer be available.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <ButtonLink href="/">Return home</ButtonLink>
          <Link href="/workflow-review" className="text-sm underline underline-offset-4">
            Request a workflow review
          </Link>
        </div>
      </div>
    </SiteShell>
  );
}
