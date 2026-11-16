'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ActivityList } from './activity-list';
import { loadOrganizationActivityAction, type ActivityResult } from './organization-activity-actions';

export function OrganizationActivity({ organizationId, timezone }: { organizationId: string; timezone: string }) {
  const [limit, setLimit] = useState(20);
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void loadOrganizationActivityAction(organizationId, limit).then(
      value => { if (active) setResult(value); },
      () => { if (active) setResult({ state: 'unavailable' }); },
    );
    return () => { active = false; };
  }, [organizationId, limit, retry]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {!result ? (
        <p role="status" className="text-sm text-muted">Loading activity...</p>
      ) : result.state === 'unavailable' ? (
        <div role="status" className="space-y-3 text-sm">
          <p>Activity is unavailable.</p>
          <Button tone="secondary" onClick={() => { setResult(null); setRetry(value => value + 1); }}>Try again</Button>
        </div>
      ) : (
        <>
          <ActivityList compact timeline={result.data.entries} timezone={timezone} emptyMessage="Nothing recorded yet." />
          {result.data.more ? (
            <Button tone="secondary" className="mt-3" onClick={() => { setResult(null); setLimit(value => Math.min(100, value + 20)); }}>Load more</Button>
          ) : null}
          {result.data.limited ? <p className="mt-3 text-xs text-muted">Older activity is outside this preview.</p> : null}
        </>
      )}
    </div>
  );
}
