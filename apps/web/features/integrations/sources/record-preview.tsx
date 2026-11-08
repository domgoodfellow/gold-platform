export type SourceRecord = {
  external_id: string;
  display_name: string | null;
  metadata: unknown;
  source_updated_at?: string | null;
};

type Pair = { label: string; value: string };

const MAX_PAIRS = 40;
const MAX_VALUE = 400;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** "createdTime" and "mime_type" read as "Created time" and "Mime type". */
function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(item => (isObject(item) || Array.isArray(item) ? JSON.stringify(item) : text(item))).join(', ') : '—';
  return JSON.stringify(value);
}

function clip(value: string): string {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
}

/** Flattens nested objects to "Parent · child" labels; arrays and long values are summarized, never dropped silently. */
export function recordPairs(metadata: unknown): Pair[] {
  if (!isObject(metadata)) return [];
  const pairs: Pair[] = [];
  if (Array.isArray(metadata.headers) && Array.isArray(metadata.values)) {
    const headers = metadata.headers as unknown[];
    const values = metadata.values as unknown[];
    const width = Math.max(headers.length, values.length);
    for (let index = 0; index < width && pairs.length < MAX_PAIRS; index += 1) {
      const header = text(headers[index]);
      pairs.push({ label: header === '—' ? `Column ${index + 1}` : header, value: clip(text(values[index])) });
    }
    return pairs;
  }
  const visit = (value: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [key, child] of Object.entries(value)) {
      if (pairs.length >= MAX_PAIRS) return;
      const label = prefix ? `${prefix} · ${humanize(key)}` : humanize(key);
      if (isObject(child) && depth < 2 && Object.keys(child).length) visit(child, label, depth + 1);
      else pairs.push({ label, value: clip(text(child)) });
    }
  };
  visit(metadata, '', 0);
  return pairs;
}

export function SourceRecordPreview({ record }: { record: SourceRecord }) {
  const pairs = recordPairs(record.metadata);
  const updated = record.source_updated_at ? new Date(record.source_updated_at) : null;
  const when = updated && !Number.isNaN(updated.getTime()) ? updated.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="min-w-0 break-words font-medium">{record.display_name || record.external_id}</span>
        {when ? <time dateTime={updated!.toISOString()} className="text-muted">Updated {when}</time> : null}
      </summary>
      {pairs.length ? (
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)]">
          {pairs.map((pair, index) => (
            <div key={`${pair.label}-${index}`} className="contents">
              <dt className="break-words text-muted">{pair.label}</dt>
              <dd className="min-w-0 break-words">{pair.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">This record has no details to show.</p>
      )}
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm text-muted">View all details</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(record.metadata, null, 2)}</pre>
      </details>
    </details>
  );
}
