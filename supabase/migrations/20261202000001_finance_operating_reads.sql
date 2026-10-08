-- Read projections only. Underlying tenant policies and immutable financial records remain authoritative.
create view public.finance_invoice_records with (security_invoker = true) as
select i.*, t.total_minor, coalesce(p.paid_minor,0) as paid_minor,
  t.total_minor-coalesce(p.paid_minor,0) as outstanding_minor,
  t.total_minor<=coalesce(p.paid_minor,0) as settled,
  t.total_minor>coalesce(p.paid_minor,0) and i.due_at < now() as overdue
from public.invoices i
join lateral (select sum(l.unit_amount_minor::bigint*l.quantity)::bigint as total_minor
  from public.invoice_lines l where l.organization_id=i.organization_id and l.invoice_id=i.id) t on true
left join lateral (select sum(p.amount_minor)::bigint as paid_minor from public.payments p
  where p.organization_id=i.organization_id and p.invoice_id=i.id) p on true;

create view public.finance_quote_records with (security_invoker = true) as
select w.id as work_item_id,w.organization_id,w.title,w.created_at,w.customer_id,c.name as customer_name,
  s.name as status,t.line_count,t.total_minor,t.currency,exists(select 1 from public.invoices i
    where i.organization_id=w.organization_id and i.work_item_id=w.id) as invoiced
from public.work_items w
join lateral (select count(*) as line_count,sum(l.unit_amount_minor::bigint*l.quantity)::bigint as total_minor,min(l.currency) as currency
  from public.work_item_priced_lines l where l.organization_id=w.organization_id and l.work_item_id=w.id having count(*)>0) t on true
left join public.customers c on c.organization_id=w.organization_id and c.id=w.customer_id
left join public.work_item_statuses s on s.organization_id=w.organization_id and s.id=w.status_id;

create view public.finance_payment_records with (security_invoker = true) as
select p.*,i.number as invoice_number,i.billed_to,i.customer_id,i.work_item_id
from public.payments p join public.invoices i on i.organization_id=p.organization_id and i.id=p.invoice_id;

grant select on public.finance_invoice_records,public.finance_quote_records,public.finance_payment_records to authenticated;

create function public.finance_dashboard_summary(p_organization_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id,'report.read') then
    raise insufficient_privilege using message='Financial reporting is not permitted.';
  end if;
  with settings as (select timezone from public.organizations where id=p_organization_id),
  invoices as (select * from public.finance_invoice_records where organization_id=p_organization_id),
  quotes as (select * from public.finance_quote_records where organization_id=p_organization_id and not invoiced),
  payments as (select p.* from public.payments p,settings z where organization_id=p_organization_id
    and received_at >= (p_from::timestamp at time zone z.timezone) and received_at < (p_to::timestamp at time zone z.timezone))
  select jsonb_build_object(
    'issued',(select count(*) from invoices),'outstandingCount',(select count(*) from invoices where not settled),
    'overdueCount',(select count(*) from invoices where overdue),'quoteCount',(select count(*) from quotes),
    'paymentCount',(select count(*) from payments),
    'outstanding',coalesce((select jsonb_agg(t) from (select currency,sum(outstanding_minor)::text as amount,count(*) as count from invoices where outstanding_minor>0 group by currency order by currency) t),'[]'),
    'quoted',coalesce((select jsonb_agg(t) from (select currency,sum(total_minor)::text as amount,count(*) as count from quotes group by currency order by currency) t),'[]'),
    'received',coalesce((select jsonb_agg(t) from (select currency,sum(amount_minor)::text as amount,count(*) as count from payments group by currency order by currency) t),'[]'),
    'aging',coalesce((select jsonb_agg(t) from (select currency,case when due_at is null then 'No due date' when due_at>=now() then 'Not yet due'
      when due_at>=now()-interval '30 days' then '1–30 days' when due_at>=now()-interval '60 days' then '31–60 days'
      when due_at>=now()-interval '90 days' then '61–90 days' else '90+ days' end as band,sum(outstanding_minor)::text as amount
      from invoices where outstanding_minor>0 group by currency,band order by currency,band) t),'[]'),
    'trend',coalesce((select jsonb_agg(t) from (select (received_at at time zone z.timezone)::date as day,currency,sum(amount_minor)::text as amount
      from payments,settings z group by day,currency order by day,currency) t),'[]')
  ) into result;
  return result;
end $$;
revoke all on function public.finance_dashboard_summary(uuid,date,date) from public;
grant execute on function public.finance_dashboard_summary(uuid,date,date) to authenticated;
