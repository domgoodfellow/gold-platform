'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { ConfigureItem } from '@/lib/navigation';

export function ConfigurationSections({ sections, children }: { sections: readonly ConfigureItem[]; children: ReactNode }) {
  const pathname = usePathname();
  const [hash, setHash] = useState('');
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, [pathname]);
  const active = [...sections].filter(section => {
    const path = section.href.split('#')[0];
    return (pathname === path || pathname.startsWith(`${path}/`)) && (section.href.includes('#') ? section.href.endsWith(hash) && hash !== '' : true);
  }).sort((a, b) => b.href.length - a.href.length)[0]?.key ?? (!hash ? sections.find(section => section.href.startsWith(`${pathname}#`))?.key : undefined);
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <nav aria-label="Configuration sections" className="px-4 pt-4 lg:sticky lg:top-(--header-height) lg:self-start lg:pt-6">
      <ul className="flex flex-wrap gap-1 lg:flex-col">
        {sections.map(section => <li key={section.key} className="min-w-0">
          <Link href={section.href} onClick={() => setHash(section.href.includes('#') ? `#${section.href.split('#')[1]}` : '')} aria-current={section.key === active ? 'page' : undefined}
            className={cx(FOCUS_RING, 'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-hover', section.key === active && 'bg-selected font-medium')}>
            <Settings2 aria-hidden className="size-4 shrink-0" /><span>{section.label}</span>
          </Link>
        </li>)}
      </ul>
    </nav>
    <div className="min-w-0">{children}</div>
  </div>;
}
