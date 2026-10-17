import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import type { StoredDocument } from '@/lib/domain/documents/documents';
import { DocumentList } from './list';
import { DocumentUploadForm, type UploadDocumentState } from './upload-form';

/**
 * A record's documents, as one composable section.
 *
 * Every entity `DOCUMENT_ENTITIES` allows renders the same section — the difference between a
 * customer's documents and a job's is entirely in which server action and hidden fields the
 * route hands it, never in this component.
 */
export function DocumentsSection({
  documents,
  organizationId,
  mayAttach,
  roleLabel,
  uploadAction,
  hiddenFields,
  className,
}: {
  documents: StoredDocument[];
  organizationId: string;
  mayAttach: boolean;
  roleLabel: string;
  uploadAction: (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;
  hiddenFields: Record<string, string>;
  className?: string;
}) {
  return (
    <Section className={className ?? 'mt-10'}>
      <SectionHeading>Documents</SectionHeading>

      <DocumentList organizationId={organizationId} documents={documents} />

      {/* Hiding the form is a courtesy, not the guard — the underlying write is refused by the
          database for anyone without document.create regardless of what this renders. */}
      {mayAttach ? (
        <DocumentUploadForm action={uploadAction} hiddenFields={hiddenFields} />
      ) : (
        <Hint className="mt-4">Your role, {roleLabel}, cannot attach documents here.</Hint>
      )}
    </Section>
  );
}
