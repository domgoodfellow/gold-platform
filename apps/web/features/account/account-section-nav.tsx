'use client';

import { usePathname } from 'next/navigation';
import { ViewNav } from '@/components/navigation/view-nav';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';

export function AccountSectionNav({ organizationId }: { organizationId: string | null }) {
  const pathname = usePathname();
  return <ViewNav label="Account" className="mb-6" items={PERSONAL_SECTIONS.map(section => ({
    key: section.key, label: section.label, href: personalSettingsHref(section.key, organizationId), current: pathname === section.path,
  }))} />;
}
