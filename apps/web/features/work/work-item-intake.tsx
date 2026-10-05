import Link from 'next/link';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { displayAnswer } from '@/features/forms/answer-display';
import type { BookingIntakeResponse } from '@/lib/domain/booking/intake';

/**
 * What the customer answered when they booked, read against the exact questions they were shown.
 * Read-only: the answers are the customer's record, kept with the booking, and editing them would
 * rewrite what was said. Absent when the booking asked nothing, or when the reader may not see
 * responses (the same authority as Studio's responses screen).
 */
export function WorkItemIntake({ organizationId, intake, timezone }: { organizationId: string; intake: BookingIntakeResponse | null; timezone: string }) {
  if (!intake) return null;
  return (
    <Section className="mt-6">
      <SectionHeading>Booking questions</SectionHeading>
      <p className="mt-1 text-sm text-muted">
        {intake.formName} · answered {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(intake.submittedAt))} ·{' '}
        <Link href={`/organizations/${organizationId}/studio/forms/${intake.formId}/submissions`} className="underline underline-offset-4">All responses</Link>
      </p>
      <dl className="mt-3 grid gap-3">
        {intake.definition.fields.map((field) => (
          <div key={field.id}>
            <dt className="text-sm font-medium">{field.label}</dt>
            <dd className="mt-0.5 whitespace-pre-line text-sm">{displayAnswer(field, intake.answers[field.id])}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
