import type { ReactNode } from 'react';
import { AppPage } from '../layout/app-page';
import { PageHeader } from '../headers/page-header';

/**
 * The content of every authenticated fallback: one heading, one sentence, one recovery action —
 * the shape of any other page (`PageHeader`), so it looks like GOLD wherever a frame surrounds it.
 * It owns no chrome. The frame is whichever layout the failing segment sits in, or
 * `GlobalFallbackShell` where no organization can be trusted; the copy never says which exists.
 */
export function FallbackPage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <AppPage>
      <PageHeader title={title} description={description} actions={action} />
    </AppPage>
  );
}
