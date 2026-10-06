import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { FOCUS_RING } from '@/components/class-names';

/** One full-row link, with the focus outline enclosing the complete target. */
export function SettingsNavigationRow({ href, title, description }: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <li>
      <Link href={href} className={`${FOCUS_RING} flex items-center gap-4 rounded px-4 py-3.5 transition-colors hover:bg-hover focus-visible:bg-hover`}>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{title}</span>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
      </Link>
    </li>
  );
}
