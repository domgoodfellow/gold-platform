import { DividedList, EmptyState } from '@/components/containers/section';
import type { StoredDocument } from '@/lib/domain/documents/documents';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({
  organizationId,
  documents,
}: {
  organizationId: string;
  documents: StoredDocument[];
}) {
  if (documents.length === 0) {
    return <EmptyState className="mt-2">Nothing attached yet.</EmptyState>;
  }

  return (
    <DividedList className="mt-2">
      {documents.map((document) => (
        <li key={document.id} className="flex items-baseline justify-between py-3">
          <div>
            {/*
              Points at our own route, never at storage. The signed URL is minted when this is
              clicked and lives sixty seconds; a link to storage rendered into this page would
              be the durable URL constraints.md forbids.
            */}
            <a
              href={`/organizations/${organizationId}/documents/${document.id}/download`}
              className="font-medium underline underline-offset-4"
            >
              {document.fileName}
            </a>
            <div className="text-sm text-muted">
              {[document.mimeType, formatSize(document.sizeBytes)].join(' · ')}
            </div>
          </div>
        </li>
      ))}
    </DividedList>
  );
}
