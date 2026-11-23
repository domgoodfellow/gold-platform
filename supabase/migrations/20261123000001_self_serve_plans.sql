-- A business can choose a GildOps plan itself (owner decision, 2026-11-23: buying no longer starts
-- with a consultation). The public plan list reads the prices Finance keeps on each plan's item and
-- only those in force; choosing a listed plan records the business as a GildOps customer and a
-- subscription in GildOps' Finance, and the existing provisioning switches the plan on. Paying stays
-- the existing checkout, required before the business launches.

-- 1. What a visitor can buy: listed, billable plans and add-ons of the operating organization, at
--    the approved list prices in force now. A plan with no such price is sold by talking to GildOps.
create or replace function public.public_plan_catalog()
returns table (plan_key text, kind text, label text, description text, requires_contact_sales boolean,
               prices jsonb, products jsonb, quotas jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with offered as (
    select p.*, i.organization_id as seller_id
      from public.platform_plans p
      join public.price_book_items i on i.id = p.price_book_item_id
     where p.sale_status = 'active' and i.sale_status = 'active' and p.billable
       and i.organization_id = app.operating_organization_id()
  ), price as (
    select o.id as plan_id, pr.currency, pr.amount_minor, pr.billing_interval, pr.effective_from
      from offered o
      join public.price_book_item_prices pr on pr.organization_id = o.seller_id and pr.item_id = o.price_book_item_id
     where pr.approval_state = 'approved'
       and pr.effective_from <= now() and (pr.effective_to is null or pr.effective_to > now())
  )
  select
    o.key,
    o.kind,
    o.label,
    o.description,
    not exists (select 1 from price where price.plan_id = o.id) as requires_contact_sales,
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', x.currency, 'amountMinor', x.amount_minor,
                                          'billingInterval', x.billing_interval)
                       order by x.currency, x.billing_interval)
        from (select distinct on (price.currency, price.billing_interval) price.*
                from price where price.plan_id = o.id
               order by price.currency, price.billing_interval, price.effective_from desc) x
    ), '[]'::jsonb) as prices,
    coalesce((
      select jsonb_agg(jsonb_build_object('key', cp.key, 'label', cp.label) order by cp.display_order)
        from public.platform_plan_product_grants g
        join public.platform_catalog_products cp on cp.id = g.product_id
       where g.plan_id = o.id
    ), '[]'::jsonb) as products,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'allowanceKey', q.allowance_key, 'label', q.label, 'unit', q.unit,
               'includedQuantity', q.included_quantity, 'period', q.period, 'overagePolicy', q.overage_policy
             ) order by q.display_order)
        from public.platform_plan_quotas q
       where q.plan_id = o.id
    ), '[]'::jsonb) as quotas
  from offered o
  order by o.kind, o.display_order, o.key;
$$;
revoke all on function public.public_plan_catalog() from public;
grant execute on function public.public_plan_catalog() to anon, authenticated;

-- 2. A business that chose its own plan is linked to its GildOps customer by that choice.
alter table public.client_tenant_relationships drop constraint client_tenant_relationships_origin_check;
alter table public.client_tenant_relationships add constraint client_tenant_relationships_origin_check
  check (origin = any (array['proposal_handoff', 'existing_tenant_link', 'migration', 'self_serve']));

-- 3. Choosing a plan. The caller manages the business's own billing; the business holds no plan and
--    is not GildOps; the plan is listed and has a list price for the interval chosen. GildOps
--    charges in the plan's own currency: the business's, when the plan is sold in it, else the
--    plan's (a business's currency is for its own work, not GildOps' price). GildOps' customer for
--    the business is reused or created, and the subscription is written in GildOps' Finance from
--    today, where its plan line provisions the business.
create function public.choose_platform_plan(p_organization_id uuid, p_plan_key text, p_billing_interval text default 'month')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_seller   uuid := app.operating_organization_id();
  v_org      public.organizations;
  v_plan     public.platform_plans;
  v_item     public.price_book_items;
  v_customer uuid;
  v_link     uuid;
  v_sub      uuid;
  v_currency text;
begin
  if v_actor is null or p_organization_id is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'billing.manage') then
    raise exception 'Only this business''s billing manager can choose its plan.' using errcode = '42501';
  end if;
  if v_seller is null or p_organization_id = v_seller then
    raise exception 'GildOps does not sell plans to this business.' using errcode = 'GD050';
  end if;
  if p_billing_interval not in ('month', 'year') then
    raise exception 'A plan is billed monthly or yearly.' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = p_organization_id;
  select * into v_plan from public.platform_plans where key = p_plan_key;
  select * into v_item from public.price_book_items where id = v_plan.price_book_item_id;
  if v_plan.id is null or v_plan.kind <> 'plan' or v_plan.sale_status <> 'active' or not v_plan.billable
     or v_item.id is null or v_item.sale_status <> 'active' or v_item.organization_id <> v_seller then
    raise exception 'That plan is not available to choose.' using errcode = 'GD051';
  end if;
  select pr.currency into v_currency
    from public.price_book_item_prices pr
   where pr.organization_id = v_seller and pr.item_id = v_item.id and pr.approval_state = 'approved'
     and pr.billing_interval = p_billing_interval
     and pr.effective_from <= now() and (pr.effective_to is null or pr.effective_to > now())
   order by (pr.currency = v_org.currency) desc nulls last, pr.currency
   limit 1;
  if v_currency is null then
    raise exception '% is not sold %; talk to GildOps.', v_plan.label,
      case p_billing_interval when 'year' then 'yearly' else 'monthly' end using errcode = 'GD053';
  end if;
  if exists (select 1 from public.organization_plan_assignments a
              where a.organization_id = p_organization_id and a.plan_kind = 'plan'
                and a.period_start <= current_date and a.period_end > current_date) then
    raise exception 'This business already has a plan; change it from Plan & usage.' using errcode = 'GD054';
  end if;

  -- GildOps' customer for this business: the one it is linked to, else one a past link named, else new.
  select r.customer_id into v_customer
    from public.client_tenant_relationships r
   where r.organization_id = v_seller and r.tenant_organization_id = p_organization_id
   order by (r.status = 'active') desc, r.created_at desc, r.id
   limit 1;
  if v_customer is null then
    insert into public.contacts (organization_id, name, contact_type, lifecycle, custom, created_by)
    values (v_seller, left(btrim(v_org.name), 200), 'company', 'customer', '{}'::jsonb, v_actor)
    returning id into v_customer;
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (v_seller, v_actor, 'customer', v_customer, 'customer.created',
            jsonb_build_object('origin', 'self_serve', 'tenantOrganizationId', p_organization_id));
  end if;
  if not exists (select 1 from public.client_tenant_relationships r
                  where r.organization_id = v_seller and r.tenant_organization_id = p_organization_id
                    and r.status = 'active') then
    insert into public.client_tenant_relationships
      (organization_id, customer_id, tenant_organization_id, origin, authority_basis, created_by)
    values (v_seller, v_customer, p_organization_id, 'self_serve', 'Chose its plan on the GildOps website', v_actor)
    returning id into v_link;
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (v_seller, v_actor, 'customer', v_customer, 'client_tenant.linked',
            jsonb_build_object('relationshipId', v_link, 'tenantId', p_organization_id, 'origin', 'self_serve'));
  end if;

  v_sub := app.write_subscription(v_seller, v_customer, v_currency, p_billing_interval, current_date, null,
                                  v_actor, 'Chosen on the GildOps website');
  perform app.write_subscription_line(v_seller, v_sub, v_item.id, 'primary', 1, current_date, null, v_actor,
                                      'Chosen on the GildOps website');

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'organization', p_organization_id, 'plan.chosen',
          jsonb_build_object('planKey', v_plan.key, 'billingInterval', p_billing_interval, 'subscriptionId', v_sub));
  return v_sub;
end $$;
revoke all on function public.choose_platform_plan(uuid, text, text) from public, anon;
grant execute on function public.choose_platform_plan(uuid, text, text) to authenticated;
comment on function public.choose_platform_plan(uuid, text, text) is
  'A business''s billing manager chooses a listed GildOps plan for it: links the business to its GildOps customer and writes the subscription in GildOps'' Finance, which provisions the plan. Payment is the existing checkout, required before launch.';

-- 4. A new environment's GildOps homepage leads with Get started (Pricing) beside Talk to us, and
--    closes on Talk to us beside See plans; the words are unchanged from 20261109000004. An existing
--    published homepage is GildOps' own content, edited in Studio, and is left as it is.
create or replace function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select $json$[
    {"kind":"hero","variant":"left","eyebrow":"","heading":"AI, automation and business software, set up around how you work.","body":"Start with one product, such as online booking or workflow automation, or connect several so customers, jobs and invoices share one record. We set each one up with you, and you check it before it goes live.","primaryCta":{"href":"/pricing","label":"Get started"},"secondaryCta":{"href":"/demo","label":"Talk to us"}},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"Tools you can use on their own.","body":"No new system to adopt first. Add one where your team loses the most time.","items":[{"title":"Websites and forms","body":"Publish a website and forms in your business's name. Edit a draft, check it, then publish.","href":"/products#websites"},{"title":"Online booking","body":"Customers pick a service and a free time without phoning. Each booking lands on your schedule.","href":"/products#booking"},{"title":"Dialer","body":"Business calls in the browser, with a call list and a record of how each call went. Not yet available to new businesses.","href":"/dialer"}]},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"AI and automation, set up with you.","body":"We agree what it may do and when it hands over to a person. Your team tests it before any customer sees it.","items":[{"title":"Workflow automation","body":"Rules that act when something happens: send an email, update a customer, create or move a job. Every run is recorded.","href":"/products#automation"},{"title":"Business assistant","body":"Ask about your customers, jobs and invoices in plain words, and get answers from records you can already see. It changes nothing unless a person approves.","href":"/products#assistant"},{"title":"AI receptionist","body":"Answers calls to your business number with information you approve, and passes the caller to a person when needed. Not yet available to new businesses.","href":"/products#ai-receptionist"}]},
    {"kind":"capabilities","variant":"list","eyebrow":"","heading":"Or connect several into one system.","body":"When sales and work share one customer record, nobody types a job in twice or asks a customer to repeat themselves.","items":[{"title":"Sales","body":"Customer records, a pipeline, tasks and email, with each customer’s history in one place.","href":"/sales"},{"title":"Operations","body":"Jobs, scheduling, dispatch, quotes, invoices and payments, from request to paid.","href":"/operations"},{"title":"Customer Service","body":"Calls, email and website conversations in one history, with support cases for anything that needs resolving. Not yet available to new businesses.","href":"/customer-service"}]},
    {"kind":"process","eyebrow":"","heading":"How a project runs.","items":[{"step":"01","title":"Tell us the job to be done","body":"Bookings taken by hand, follow-ups forgotten, the same customer details typed in twice. We start from the task, not a product list."},{"step":"02","title":"Agree scope and price","body":"What we set up, what connects to the tools you keep, and what is charged for setup, each month and by usage."},{"step":"03","title":"Set up and test","body":"Your team tries it on real work. Anything AI says is reviewed before a customer sees it."},{"step":"04","title":"Go live and adjust","body":"Launch when you are ready, then add or change products as the business changes."}]},
    {"kind":"trust","eyebrow":"","heading":"What you can count on.","items":[{"title":"One product is not a commitment","body":"Using one product does not mean moving the rest of your business into GildOps."},{"title":"You approve AI before it goes live","body":"You decide what an assistant may say and when a person takes over, and you test it first."},{"title":"Costs in writing","body":"Setup, ongoing fees and usage are listed separately in your quote."},{"title":"Plain about what is ready","body":"Every product says whether it is available, in testing or not yet available, so you know what you can start with now."}]},
    {"kind":"cta","heading":"What would you like to fix first?","body":"Tell us the task, the tools you use now and who does the work. We will tell you which product fits, what setting it up involves and what it costs.","primaryCta":{"href":"/demo","label":"Talk to us"},"secondaryCta":{"href":"/pricing","label":"See plans"}}
  ]$json$::jsonb;
$function$;

-- 5. Verification.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'choose_platform_plan') then
    raise exception 'choose_platform_plan missing';
  end if;
  if has_function_privilege('anon', 'public.choose_platform_plan(uuid, text, text)', 'execute') then
    raise exception 'a signed-out caller can choose a plan';
  end if;
end $$;
