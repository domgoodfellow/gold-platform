import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '@/components/marketing/legal-document';

const TITLE = 'Privacy · GOLD';
const DESCRIPTION = 'What GOLD collects when you use this website or send us a message, and how it is used.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/privacy' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/privacy' },
};

/**
 * Initial text, written only from what the application demonstrably does today: the demo and
 * contact forms (`lib/domain/public-intake`), and the separation between a business's own records
 * and GOLD's. Every `LEGAL-REVIEW` marker below is a clause that states a fact or a promise the
 * business or its counsel must confirm before production publication — none is filled in here.
 * `pendingReview` stays true until they have.
 */
const SECTIONS: LegalSection[] = [
  {
    heading: 'What this page covers',
    body: (
      <p>
        This page describes the personal information GOLD collects through this website — the
        marketing pages, the demo request form and the contact form. It does not describe how a
        business that uses GOLD handles its own customers&rsquo; information; that business decides
        what it collects and why.
      </p>
    ),
  },
  {
    heading: 'What we collect',
    body: (
      <>
        <p>
          When you send a demo request or a message, we collect what you type into the form: your
          name, email address, business or organization name, and your message. On the demo form we
          also collect an optional phone number, team size and short description of your tools.
        </p>
        <p>
          To accept a form, the site starts a short-lived, anonymous session in your browser. It ends
          as soon as your submission has been recorded.
        </p>
        {/* LEGAL-REVIEW: whether analytics, cookies or server logs beyond the above are in use,
            and if so what they record. Nothing is claimed here about them. */}
      </>
    ),
  },
  {
    heading: 'How we use it',
    body: (
      <>
        <p>
          We use what you send to respond to that request and to keep the conversation with the
          record of who asked. Submitting a form does not opt you into marketing messages.
        </p>
        {/* LEGAL-REVIEW: the lawful basis or consent wording required for each jurisdiction GOLD
            sells into, and any commercial-electronic-message or telemarketing rules for follow-up. */}
      </>
    ),
  },
  {
    heading: 'Who can see it',
    body: (
      <p>
        Submissions are stored in GOLD&rsquo;s own workspace and are visible to GOLD staff who handle
        enquiries. The person submitting a form cannot read it back afterwards, and it is not
        visible to any other business using GOLD.
        {/* LEGAL-REVIEW: the categories of service provider that process this data on GOLD's
            behalf, and any transfers outside the visitor's country. */}
      </p>
    ),
  },
  {
    heading: 'How long we keep it',
    body: (
      <p>
        {/* LEGAL-REVIEW: no retention period has been set. State it here once decided. */}
        We keep enquiries for as long as we need them to respond and to keep an accurate record of the
        conversation.
      </p>
    ),
  },
  {
    heading: 'Your choices',
    body: (
      <p>
        You can ask us what we hold about you, ask us to correct it, or ask us to delete it, by
        writing to us through the contact page.
        {/* LEGAL-REVIEW: the rights and response times that apply by jurisdiction, and a named
            privacy contact if one is required. */}
      </p>
    ),
  },
  {
    heading: 'Changes to this page',
    body: <p>If we change how we handle this information, we will update this page.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy"
      intro="What GOLD collects when you use this website or send us a message, and how it is used."
      sections={SECTIONS}
      pendingReview
    />
  );
}
