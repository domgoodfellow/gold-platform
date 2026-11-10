import { formatPhoneForDisplay } from '@/lib/display/phone';
import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';
import { FOCUS_RING, cx } from '@/components/class-names';
import { ACCOUNT_LINKS, COMPANY_LINKS, LEGAL_LINKS, PRODUCT_LINKS } from '@/lib/marketing/navigation';

const COLUMNS = [
  { heading: 'Products', links: PRODUCT_LINKS },
  { heading: 'Company', links: COMPANY_LINKS },
  { heading: 'Account', links: ACCOUNT_LINKS },
  { heading: 'Legal', links: LEGAL_LINKS },
] as const;

const LINK = cx('rounded text-sm opacity-70 transition-opacity hover:opacity-100', FOCUS_RING);

/**
 * GOLD's own footer. The contact channels come from GOLD's public profile and are omitted when
 * unset — nothing here invents an address a business has not given.
 */
export function MarketingFooter({
  name,
  tagline,
  contactEmail,
  contactPhone,
}: {
  name: string;
  tagline: string;
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  return (
    <footer className="mt-16 bg-foreground text-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8 sm:py-14">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.6fr_repeat(4,1fr)] md:gap-8">
          <div className="flex flex-col gap-4">
            <span className="text-2xl font-semibold tracking-tight">{name}</span>
            <p className="max-w-xs text-sm leading-relaxed opacity-70">{tagline}</p>
            {contactEmail || contactPhone ? (
              <ul className="flex flex-col gap-2 text-sm">
                {contactEmail ? (
                  <li>
                    <a href={`mailto:${contactEmail}`} className={cx('inline-flex items-center gap-2', LINK)}>
                      <Mail aria-hidden size={14} />{contactEmail}
                    </a>
                  </li>
                ) : null}
                {contactPhone ? (
                  <li>
                    <a href={`tel:${contactPhone.replace(/[^\d+]/g, '')}`} className={cx('inline-flex items-center gap-2', LINK)}>
                      <Phone aria-hidden size={14} />{formatPhoneForDisplay(contactPhone)}
                    </a>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] opacity-50">{column.heading}</h2>
              <ul className="flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={LINK}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col-reverse items-start justify-between gap-3 border-t border-background/15 pt-6 text-xs opacity-70 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} {name}</span>
          <span className="flex items-center gap-2">
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <span aria-hidden>·</span>
            <Link href="/terms" className="hover:underline">Terms</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
