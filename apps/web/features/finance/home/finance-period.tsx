import { PeriodField } from '@/components/controls/period-field';

/** The reporting month: the shared period control, applied as soon as a month is chosen. */
export function FinancePeriod({ action, month }: { action: string; month: string }) {
  return <PeriodField action={action} name="month" type="month" label="Reporting month" value={month} />;
}
