-- The margin summary, corrected twice over: it must use the reconciled cost once one exists
-- rather than the estimate it superseded, and it must never subtract a provider cost from a
-- customer charge recorded in a different currency.
--
-- **Why a mismatched pair reports no margin rather than a converted one.** I10's own rule,
-- applied here rather than invented for it: `jobEconomics` already returns a null margin when a
-- job's costs and revenue disagree on currency, because a platform-chosen exchange rate would be
-- the platform answering a question nobody asked it. D40 named the same fact as "one thing
-- unsolved: the spread" the day it shipped voice. This migration keeps it unsolved rather than
-- solving it quietly -- a real conversion, if this repository ever builds one, is a rate with a
-- date and a snapshot of which one was used (I8), not a division performed inside a report.
--
-- **The one exception, and it is not a conversion.** A provider cost of exactly zero is zero in
-- every currency at once -- there is nothing to convert, so subtracting it from a customer
-- charge asserts nothing about an exchange rate. Every other mismatch reports `margin_minor` as
-- null.

drop function if exists public.organization_commercial_summary(uuid, date, date);

create function public.organization_commercial_summary(
  p_organization_id uuid,
  p_from            date default null,
  p_to              date default null
)
returns table (
  meter_id               text,
  customer_currency      text,
  customer_charge_minor  bigint,
  provider_currency      text,
  provider_cost_minor    bigint,
  quantity               bigint,
  margin_minor           bigint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with effective as (
    -- The reconciled cost when one exists, otherwise the original estimate -- never both, and
    -- never a second quantity or customer charge, since neither column is read from the
    -- reconciliation at all.
    select u.meter_id,
           u.customer_currency,
           u.customer_charge_micros,
           u.quantity,
           coalesce(r.reconciled_provider_cost_micros, u.provider_cost_micros) as provider_cost_micros,
           coalesce(r.provider_currency, u.provider_currency)                 as provider_currency
      from public.usage_events u
      left join lateral (
        select rec.reconciled_provider_cost_micros, rec.provider_currency
          from public.usage_cost_reconciliations rec
         where rec.organization_id = u.organization_id
           and rec.usage_event_id = u.id
         order by rec.reconciled_at desc
         limit 1
      ) r on true
     where u.organization_id = p_organization_id
       and (p_from is null or u.occurred_at >= p_from::timestamptz)
       and (p_to   is null or u.occurred_at <  p_to::timestamptz)
  )
  select e.meter_id,
         e.customer_currency,
         round(sum(e.customer_charge_micros) / 1000000.0)::bigint,
         e.provider_currency,
         round(sum(e.provider_cost_micros) / 1000000.0)::bigint,
         sum(e.quantity)::bigint,
         case
           when sum(e.provider_cost_micros) = 0
             then round(sum(e.customer_charge_micros) / 1000000.0)::bigint
           when e.customer_currency = e.provider_currency
             then round((sum(e.customer_charge_micros) - sum(e.provider_cost_micros)) / 1000000.0)::bigint
           else null
         end as margin_minor
    from effective e
   group by e.meter_id, e.customer_currency, e.provider_currency
   order by e.meter_id, e.customer_currency, e.provider_currency;
$fn$;

comment on function public.organization_commercial_summary(uuid, date, date) is
  'Usage, GOLD''s own effective cost (reconciled where one exists, else the estimate), the customer''s charge, and the margin between them -- null whenever cost and charge disagree on currency and the cost is not exactly zero, rather than a converted number nobody asked for. Grouped by currency pair, the same reason invoiced_and_incurred groups by currency (I10). Never granted to authenticated.';

revoke all on function public.organization_commercial_summary(uuid, date, date) from public;
grant execute on function public.organization_commercial_summary(uuid, date, date) to platform_staff;
