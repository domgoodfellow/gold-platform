import type { ReactNode } from 'react';
import { StatePage } from '../patterns/state';

/**
 * The content of every authenticated fallback: the State/Exception pattern, not `PageHeader` — a
 * refusal or a missing page is not an ordinary screen with page actions. It owns no chrome. The
 * frame is whichever layout the failing segment sits in, or `GlobalFallbackShell` where no
 * organization can be trusted; the copy never says which exists.
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
  return <StatePage title={title} description={description} action={action} />;
}
