import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '@/components/marketing/legal-document';

const TITLE = 'Terms · GildOps';
const DESCRIPTION = 'The terms for using the GildOps website.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/terms' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/terms' },
};

/**
 * Initial text for using this *website* only. The terms of the GOLD service itself — fees,
 * service levels, liability, governing law — are not written here and are not implied by it; they
 * belong to an agreement the business and its counsel have not yet supplied. Each `LEGAL-REVIEW`
 * marker is a clause that needs that confirmation before production publication.
 * `pendingReview` stays true until it has.
 */
const SECTIONS: LegalSection[] = [
  {
    heading: 'Using this website',
    body: (
      <p>
        You may browse this website and use its demo and contact forms for their intended purpose.
        Please do not misuse the forms, submit anything unlawful, or try to disrupt or gain access to
        parts of the site you are not meant to reach.
      </p>
    ),
  },
  {
    heading: 'Information on this website',
    body: (
      <>
        <p>
          The pages here describe GildOps to help you decide whether to talk to us. They are not an offer
          or a commitment about any particular feature, price or outcome; those are settled in a
          separate agreement if you become a customer.
        </p>
        {/* LEGAL-REVIEW: any disclaimer of warranty or limitation of liability for site content. */}
      </>
    ),
  },
  {
    heading: 'Using GildOps as a customer',
    body: (
      <p>
        Using GildOps as a business is governed by the agreement between that business and GildOps, not by
        this page.
        {/* LEGAL-REVIEW: the customer agreement, fees, service levels and acceptable-use terms.
            None is written or implied here. */}
      </p>
    ),
  },
  {
    heading: 'Intellectual property',
    body: (
      <p>
        {/* LEGAL-REVIEW: ownership and permitted-use wording for the GOLD name, logo and content. */}
        The GildOps name, logo and website content belong to GildOps. Please ask before reusing them.
      </p>
    ),
  },
  {
    heading: 'Governing law',
    body: (
      <p>
        {/* LEGAL-REVIEW: the governing law and venue. None has been chosen. */}
        The governing law and venue for these terms will be stated here once confirmed.
      </p>
    ),
  },
  {
    heading: 'Changes to these terms',
    body: <p>We may update these terms as the website changes. The current version is always the one on this page.</p>,
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms"
      intro="The terms for using the GildOps website."
      sections={SECTIONS}
      pendingReview
    />
  );
}
