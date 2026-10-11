'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TextInput } from '@/components/controls/inputs';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { HELP_ARTICLES, searchHelp } from '@/lib/help/articles';

/** The help index with real search over the articles' titles, summaries and text. */
export function HelpBrowser({ organizationId }: { organizationId: string }) {
  const [query, setQuery] = useState('');
  const articles = searchHelp(query, HELP_ARTICLES);

  return (
    <div className="flex flex-col gap-4">
      <TextInput
        type="search"
        aria-label="Search help"
        placeholder="Search help"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {articles.length === 0 ? (
        <EmptyState>Nothing in help matches “{query.trim()}”. Try another word, or contact GildOps Support.</EmptyState>
      ) : (
        <DividedList className="border-y border-border">
          {articles.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/organizations/${organizationId}/help/${article.slug}`}
                className="flex flex-col gap-0.5 px-1 py-3 hover:bg-hover"
              >
                <span className="font-medium">{article.title}</span>
                <span className="text-sm text-muted">{article.summary}</span>
              </Link>
            </li>
          ))}
        </DividedList>
      )}
    </div>
  );
}
