'use client';

import { useState } from 'react';
import { Chart } from '@/components/charts/charts';
import { CHART_FIXTURES } from '@/components/charts/chart-fixtures';

/** Every fixture at full and narrow width, plus the currency switch. Theme follows the system or `?theme=`. */
export function ChartGallery() {
  const [currency, setCurrency] = useState('CAD');
  const payments = currency === 'CAD' ? CHART_FIXTURES.paymentsWithCorrections : CHART_FIXTURES.paymentsUsd;
  return <main className="mx-auto flex max-w-6xl flex-col gap-8 bg-background p-4 text-foreground">
    <h1 className="text-xl font-semibold">Shared charts</h1>
    <section aria-label="Currency switch" className="rounded-lg border border-border bg-surface p-4">
      <Chart title="Payments received" data={payments.data} variants={[{ key: 'CAD', label: 'CAD' }, { key: 'USD', label: 'USD' }]} variant={currency} onVariantChange={setCurrency} />
    </section>
    {Object.entries(CHART_FIXTURES).map(([key, fixture]) => <section key={key} aria-label={key} className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="rounded-lg border border-border bg-surface p-4"><p className="mb-2 text-xs text-muted">{fixture.note}</p><Chart title={fixture.title} data={fixture.data} /></div>
      <div className="w-full max-w-[17rem] rounded-lg border border-border bg-surface p-3" data-narrow><Chart title={fixture.title} data={fixture.data} height="compact" /></div>
    </section>)}
  </main>;
}
