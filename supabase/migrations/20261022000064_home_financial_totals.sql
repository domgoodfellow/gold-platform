-- Preserve the existing invoiced/incurred facts without transferring every Customer group
-- to Home. The canonical invoker report continues to enforce report.read and tenant RLS.
create function public.home_financial_totals(p_organization_id uuid,p_from date,p_to date)
returns table(currency text,invoiced_minor numeric,incurred_minor numeric,margin_minor numeric)
language sql stable security invoker set search_path = '' as $$
  select f.currency,sum(f.invoiced_minor),sum(f.incurred_minor),sum(f.margin_minor)
  from public.invoiced_and_incurred(p_organization_id,'customer',p_from,p_to) f
  group by f.currency order by f.currency
$$;
revoke all on function public.home_financial_totals(uuid,date,date) from public,anon;
grant execute on function public.home_financial_totals(uuid,date,date) to authenticated;
comment on function public.home_financial_totals(uuid,date,date) is 'Per-currency totals of the canonical invoiced/incurred report, retaining its report.read and Organization-local exclusive date semantics.';
