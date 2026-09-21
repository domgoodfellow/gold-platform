'use client';

import { useParams } from 'next/navigation';
import { platformHref } from '@/lib/platform-navigation';
import { FallbackPage } from '@/components/containers/fallback-page';
import { ButtonLink } from '@/components/controls/button';

/**
 * Inside the Platform layout, so an unknown address or a missing catalogue record keeps Platform
 * context (sidebar, phone bar, switcher) rather than falling to the public 404.
 */
export default function PlatformNotFound() {
  const { organizationId: goldId } = useParams<{ organizationId: string }>();
  return (
    <FallbackPage
      title="This page does not exist"
      description="The address may have changed, or the record may no longer be available."
      action={<ButtonLink href={platformHref(goldId, '')}>Back to Platform overview</ButtonLink>}
    />
  );
}
