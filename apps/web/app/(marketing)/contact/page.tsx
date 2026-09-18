import type { Metadata } from 'next';
import { Mail, Phone } from 'lucide-react';
import { CtaBand } from '@/components/marketing/cta-band';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';
import { sendContactAction } from './actions';
import { ContactForm } from './contact-form';

const TITLE = 'Contact · GOLD';
const DESCRIPTION = 'Send GOLD a question about sales, an existing account, billing or a partnership.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/contact' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/contact' },
};

export default async function ContactPage() {
  const { profile } = await getPublishedGoldHomepage();
  // Only channels GOLD has actually configured; nothing is filled in on its behalf.
  const methods = [
    profile.contactEmail ? { icon: Mail, label: 'Email', value: profile.contactEmail, href: `mailto:${profile.contactEmail}` } : null,
    profile.contactPhone ? { icon: Phone, label: 'Phone', value: profile.contactPhone, href: `tel:${profile.contactPhone.replace(/[^\d+]/g, '')}` } : null,
  ].filter((method) => method !== null);

  return (
    <div className="flex flex-col gap-16 py-6 sm:gap-20 sm:py-10">
      <section className="-mx-2 rounded-2xl bg-secondary px-6 py-12 sm:px-12 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Contact</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Questions? Send us a message.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          For a general question, an existing account, billing or a partnership. Looking to see GOLD
          on your own business? Request a demo instead.
        </p>
      </section>

      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        {methods.length > 0 ? (
          <section aria-labelledby="reach-us" className="flex flex-col gap-4">
            <h2 id="reach-us" className="text-xl font-semibold tracking-tight">Reach us directly</h2>
            <ul className="flex flex-col gap-3">
              {methods.map(({ icon: Icon, label, value, href }) => (
                <li key={label}>
                  <a href={href} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-foreground/40">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background"><Icon aria-hidden size={18} /></span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs text-subtle">{label}</span>
                      <span className="truncate font-medium">{value}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="send-message" className={methods.length > 0 ? '' : 'lg:col-span-2 lg:max-w-2xl'}>
          <h2 id="send-message" className="mb-6 text-xl font-semibold tracking-tight">Send a message</h2>
          <ContactForm action={sendContactAction} />
        </section>
      </div>

      <CtaBand
        heading="Want to see GOLD on your business?"
        body="Tell us how you run today and we’ll show you the parts of GOLD that fit it."
      />
    </div>
  );
}
