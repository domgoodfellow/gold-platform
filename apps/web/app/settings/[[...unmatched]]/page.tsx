import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * An address beneath `/settings` that is not Personal settings (`/settings/account`). Like the
 * organization and Platform catch-alls, it exists so the failure renders in `settings/not-found.tsx`
 * — inside an authenticated frame — instead of Next's root 404 outside every segment. Optional so
 * a bare `/settings` (which people type) is covered too.
 */
export default function UnmatchedSettingsRoute() {
  notFound();
}
