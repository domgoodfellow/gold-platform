'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { ButtonLink } from '@/components/controls/button';
import { setupReturnHref } from '@/lib/route/setup-context';

/** Shown only when the operator explicitly entered a canonical editor from Setup. */
export function SetupReturnLink() {
  const pathname = usePathname();
  const query = useSearchParams();
  const href = setupReturnHref(pathname, query?.get('setupStep') ?? null);
  return href ? <div className="mb-3"><ButtonLink size="small" tone="text" href={href}>Return to setup</ButtonLink></div> : null;
}
