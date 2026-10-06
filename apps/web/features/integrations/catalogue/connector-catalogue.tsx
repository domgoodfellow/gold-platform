import Link from 'next/link';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { cx, FOCUS_RING } from '@/components/class-names';
import { Badge } from '@/components/display/data';
import { DividedList, EmptyState, Section } from '@/components/surfaces/section';
import { BROWSE_FILTERS, type BrowseFilter, type Connector } from '@/lib/domain/integrations/connectors';
import { ConnectorCard } from './connector-card';
import { ConnectorIcon } from './connector-icon';

// A wide desktop canvas reaches three or four cards; a card never stretches taller than its own
// content just to keep a row aligned. Not `sm:grid-cols-2` — that caps at two columns forever,
// however wide the viewport, which is the exact limitation this replaces.
const GRID = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]';

const FILTER_LABEL: Record<BrowseFilter, string> = { available: 'Available', connected: 'Connected', upcoming: 'Upcoming' };

/**
 * Connections → Browse: what this business can connect *now*. The default view holds only
 * connectable apps, because a catalogue that mostly renders what is not available buries the one
 * thing that is. What is planned is a roadmap, one filter away, with a badge and no control.
 *
 * Categories are derived from the set on screen — never a list kept here, and never a pill whose
 * only contents are somewhere else.
 */
export function ConnectorCatalogue({
  organizationId,
  connectors,
  logoUrlByKey,
  connectedKeys,
  mayManage,
  filter,
  counts,
  categories,
  query,
  category,
  hrefFor,
}: {
  organizationId: string;
  /** Already narrowed to the filter, the query and the category by the route. */
  connectors: Connector[];
  logoUrlByKey: Map<string, string | null>;
  connectedKeys: Set<string>;
  mayManage: boolean;
  filter: BrowseFilter;
  /** What each filter holds before the query and category narrow it. */
  counts: Record<BrowseFilter, number>;
  categories: string[];
  query: string;
  category: string;
  hrefFor: (next: { filter?: BrowseFilter; q?: string; category?: string }) => string;
}) {
  return (
    <Section className="mt-6">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show">
        {BROWSE_FILTERS.map((name) => (
          <Link
            key={name}
            href={hrefFor({ filter: name, q: query })}
            aria-current={filter === name ? 'true' : undefined}
            className={cx(
              'rounded-full border px-3 py-1 text-sm',
              FOCUS_RING,
              filter === name ? 'border-accent bg-accent text-on-accent' : 'border-border text-muted hover:text-foreground',
            )}
          >
            {FILTER_LABEL[name]} <span className="opacity-70">{counts[name]}</span>
          </Link>
        ))}
      </div>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="filter" value={filter} />
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <TextInput name="q" type="search" defaultValue={query} placeholder="Search apps" aria-label="Search apps" className="w-full sm:w-72" />
        <Button type="submit" tone="secondary" size="small">
          Search
        </Button>
      </form>

      {categories.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Category">
          {['', ...categories].map((name) => (
            <Link
              key={name || 'all'}
              href={hrefFor({ filter, q: query, category: name })}
              aria-current={category === name ? 'true' : undefined}
              className={cx(
                'rounded-full border px-3 py-1 text-sm',
                FOCUS_RING,
                category === name ? 'border-accent bg-accent text-on-accent' : 'border-border text-muted hover:text-foreground',
              )}
            >
              {name || 'All'}
            </Link>
          ))}
        </div>
      ) : null}

      {connectors.length === 0 ? (
        <EmptyState className="mt-4">{emptyMessage(filter, query)}</EmptyState>
      ) : filter === 'upcoming' ? (
        <DividedList className="mt-4 border-y border-border">
          {connectors.map((connector) => (
            <li key={connector.key} className="flex items-center gap-3 py-3">
              <ConnectorIcon connector={connector} logoUrl={logoUrlByKey.get(connector.key) ?? null} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{connector.name}</p>
                <p className="text-sm text-muted">{connector.description}</p>
              </div>
              <Badge tone="neutral">Planned</Badge>
            </li>
          ))}
        </DividedList>
      ) : (
        <div className={cx('mt-4', GRID)}>
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.key}
              connector={connector}
              logoUrl={logoUrlByKey.get(connector.key) ?? null}
              organizationId={organizationId}
              connected={connectedKeys.has(connector.key)}
              mayManage={mayManage}
            />
          ))}
        </div>
      )}

      {filter === 'available' && counts.upcoming > 0 ? (
        <p className="mt-6 text-sm text-muted">
          {counts.upcoming} more {counts.upcoming === 1 ? 'is' : 'are'} planned.{' '}
          <Link href={hrefFor({ filter: 'upcoming' })} className={cx('underline underline-offset-4', FOCUS_RING)}>
            View upcoming
          </Link>
        </p>
      ) : null}
    </Section>
  );
}

function emptyMessage(filter: BrowseFilter, query: string): string {
  if (query !== '') return 'No app matches that search.';
  if (filter === 'available') return 'Nothing is available to connect right now.';
  if (filter === 'connected') return 'No app is connected yet.';
  return 'Nothing is planned yet.';
}
