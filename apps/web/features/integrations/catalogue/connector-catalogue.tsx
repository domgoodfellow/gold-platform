import Link from 'next/link';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { cx, FOCUS_RING } from '@/components/class-names';
import { EmptyState, Section } from '@/components/containers/section';
import type { Connector } from '@/lib/domain/integrations/connectors';
import { ConnectorCard } from './connector-card';

/**
 * Integrations → Browse: an app catalogue. With no search and no category chosen, connectors
 * group under the categories the catalogue itself carries (`connector.category`) — never a list
 * hardcoded in this file, so a category an admin adds shows up here without a deploy.
 */
export function ConnectorCatalogue({
  organizationId,
  connectors,
  logoUrlByKey,
  connectedKeys,
  mayManage,
  categories,
  query,
  category,
  categoryHref,
}: {
  organizationId: string;
  /** Already filtered by query/category — the route's own `filterConnectors` call. */
  connectors: Connector[];
  logoUrlByKey: Map<string, string | null>;
  connectedKeys: Set<string>;
  mayManage: boolean;
  categories: string[];
  query: string;
  category: string;
  categoryHref: (next: { q?: string; category?: string }) => string;
}) {
  const grouped = query === '' && category === '' ? groupByCategory(connectors, categories) : null;

  return (
    <Section className="mt-6">
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value="browse" />
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <TextInput name="q" type="search" defaultValue={query} placeholder="Search apps" aria-label="Search apps" className="w-full sm:w-72" />
        <Button type="submit" tone="secondary" size="small">
          Search
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Category">
        {['', ...categories].map((name) => (
          <Link
            key={name || 'all'}
            href={categoryHref({ q: query, category: name })}
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

      {connectors.length === 0 ? (
        <EmptyState className="mt-4">No app matches that search.</EmptyState>
      ) : grouped ? (
        <div className="mt-4 flex flex-col gap-6">
          {grouped.map((group) => (
            <div key={group.category}>
              <h3 className="mb-2 text-sm font-medium text-subtle">{group.category}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.items.map((connector) => (
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
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
    </Section>
  );
}

function groupByCategory(connectors: Connector[], categories: string[]): { category: string; items: Connector[] }[] {
  return categories
    .map((category) => ({ category, items: connectors.filter((connector) => connector.category === category) }))
    .filter((group) => group.items.length > 0);
}
