-- The customer-facing Product set becomes the eight Gild Products, and the shared workspace stops
-- pretending to be one of them.
--
-- Before: crm, communications, operations, financial_operations, automation, insights,
-- customer_experience -- the seven Products of the first catalogue.
-- After:  sales, service, comms, finance, agents, automations, field, studio -- and one further row,
-- `workspace`, of a different *kind*, that holds the reporting Features every Product reuses.
--
-- **Nothing is re-created.** Every Product, Module and Feature keeps its id, so every Plan grant
-- (product, module or feature), every organization activation override and every runtime mapping
-- keeps pointing at exactly what it pointed at. A Product is renamed in place; two Modules or
-- Features that belong somewhere else are *moved* by changing their parent, not copied.
--
--   crm                   -> sales        (CRM is a module area inside Sales, not a peer Product)
--   communications        -> comms
--   operations            -> field        (Scheduling and Field operations are modules of Field)
--   financial_operations  -> finance
--   automation            -> automations
--   customer_experience   -> studio       (website, booking, portal, forms, brand; marketing joins it)
--   insights              -> workspace    (kind = 'workspace': dashboards, reports, analytics)
--
-- Two Products are new. **Agents** has runtime evidence today -- the Ask module (`assistant`) is real
-- -- so the Module that held it, `insights.intelligence`, moves there whole, together with the one
-- planned Feature about agent tools. **Service** has none: it is created with planned Features only,
-- `unlisted` and `experimental`, so the catalogue says what is intended without claiming any of it.
--
-- **Why a `kind` column and not a ninth Product.** Reporting is horizontal: every Product exposes a
-- dashboard, activity and reports over the same aggregate, and a business does not buy "Insights"
-- beside its Sales. But Plan grants and activation resolve through Product -> Module -> Feature, so
-- the reporting Features need a parent, and a parent that is not a sellable Product has to be
-- distinguishable from one. `kind` is that distinction. The customer-facing Product set is
-- `kind = 'product'` and is exactly eight; `workspace` is the shared capability beneath them.
--
-- **No entitlement is lost.** A Plan that granted the whole old Insights Product now grants
-- `workspace`, which lost exactly one Module (`intelligence`, moved to Agents), so each such Plan is
-- given a grant of that Module. GOLD Internal, which grants every implemented capability, also gains
-- the two new Products: `all_available` grants only what is implemented, so Service adds nothing
-- today and picks up whatever ships.

alter table public.platform_catalog_products
  add column kind text not null default 'product'
    check (kind in ('product', 'workspace'));

comment on column public.platform_catalog_products.kind is
  'product = one of the eight customer-facing Gild Products; workspace = the shared capability under all of them (reporting, dashboards, activity), which a Plan may grant but a customer does not buy as a Product.';

alter table public.platform_catalog_products
  drop constraint platform_catalog_products_key_check;

-- Rename in place, one row per statement. The key check is re-added below, once every row satisfies it.
update public.platform_catalog_products set key = 'sales', label = 'Gild Sales', display_order = 1,
  description = 'Who a business is selling to and where each is in the relationship: customers, contacts, leads, the pipeline and sales activity.'
  where key = 'crm';
update public.platform_catalog_products set key = 'comms', label = 'Gild Comms', display_order = 3,
  description = 'How a business communicates: calls and voice, SMS and email, and the numbers and identities they run on.'
  where key = 'communications';
update public.platform_catalog_products set key = 'finance', label = 'Gild Finance', display_order = 4,
  description = 'What a business charges, bills, collects, spends and earns: price book, quotes, invoices, payments and job economics.'
  where key = 'financial_operations';
update public.platform_catalog_products set key = 'automations', label = 'Gild Automations', display_order = 6,
  description = 'What should happen automatically: rules a business writes, what starts them, what they do and the record of what ran.'
  where key = 'automation';
update public.platform_catalog_products set key = 'field', label = 'Gild Field', display_order = 7,
  description = 'What work is being done, where, when and with what: work, scheduling, resources, locations and assets, and dispatch policy over them.'
  where key = 'operations';
update public.platform_catalog_products set key = 'studio', label = 'Gild Studio', display_order = 8,
  description = 'The public, customer-facing experience a business operates: website, booking, forms, the customer portal, brand and domains, and marketing.'
  where key = 'customer_experience';
update public.platform_catalog_products set key = 'workspace', kind = 'workspace', label = 'Gild Workspace', display_order = 9,
  description = 'The shared capability every Product reuses: saved dashboards, reports and analytics over one reporting aggregate. Not a Product a business buys.'
  where key = 'insights';

insert into public.platform_catalog_products (key, label, description, lifecycle, sale_status, display_order) values
  ('service', 'Gild Service', 'What customer support and service issues are being managed: cases, requests, assignment and service levels. Nothing here is built yet.', 'experimental', 'unlisted', 2),
  ('agents', 'Gild Agents', 'The intelligent workers and assistants an organization has configured and deployed: what they can be asked, what tools and knowledge they have, and what they ran.', 'beta', 'active', 5);

-- The old keys are gone from the allowed set, so none can be written again: a Product row can no
-- longer be inserted or renamed to crm, operations, insights and the rest.
alter table public.platform_catalog_products
  add constraint platform_catalog_products_key_check
    check (key = any (array['sales', 'service', 'comms', 'finance', 'agents', 'automations', 'field', 'studio', 'workspace']))
  ,
  add constraint platform_catalog_products_workspace_kind
    check ((key = 'workspace') = (kind = 'workspace'));

-- Agents ---------------------------------------------------------------------
-- The Module that held Ask moves whole; its Features (one available, two planned) keep their ids.
update public.platform_catalog_modules
   set product_id = (select id from public.platform_catalog_products where key = 'agents'),
       label = 'Assistant & answers',
       description = 'Asking an assistant about a business and getting an answer built from what the asker may already see.',
       display_order = 1
 where key = 'intelligence'
   and product_id = (select id from public.platform_catalog_products where key = 'workspace');

insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
  select id, 'tools', 'Agent tools', 'The domain tools an agent may call, each with its validation and permission attached.', 2
    from public.platform_catalog_products where key = 'agents';

update public.platform_catalog_features
   set module_id = (select m.id from public.platform_catalog_modules m
                     join public.platform_catalog_products p on p.id = m.product_id
                    where p.key = 'agents' and m.key = 'tools'),
       display_order = 1
 where key = 'agent_tools'
   and module_id = (select m.id from public.platform_catalog_modules m
                     join public.platform_catalog_products p on p.id = m.product_id
                    where p.key = 'sales' and m.key = 'data');

-- Service: planned only ------------------------------------------------------
insert into public.platform_catalog_modules (product_id, key, label, description, display_order)
  select id, 'cases', 'Cases & requests', 'The support or service issue itself: how it arrives, who has it and how long it may take.', 1
    from public.platform_catalog_products where key = 'service';

insert into public.platform_catalog_features
  (module_id, key, label, description, lifecycle, implementation_state, packaging_default, display_order)
  select m.id, f.key, f.label, f.description, 'experimental', 'planned', 'optional', f.ord
    from public.platform_catalog_modules m
    join public.platform_catalog_products p on p.id = m.product_id and p.key = 'service'
    cross join (values
      ('case_records', 'Cases', 'A record for one service issue, with its own history.', 1),
      ('support_inbox', 'Support inbox', 'Where new service issues arrive to be triaged.', 2),
      ('case_assignment', 'Assignment and handoff', 'Who has a case, and passing it on.', 3),
      ('service_levels', 'Service levels', 'How long a case may take, and the status that says whether it is on time.', 4)
    ) as f(key, label, description, ord)
   where m.key = 'cases';

-- Keep every Plan's reach ------------------------------------------------------
-- A whole-Product grant on the old Insights now covers `workspace`, which no longer contains
-- `intelligence`; give the same Plans that Module so what they could use, they still can.
insert into public.platform_plan_module_grants (plan_id, module_id)
  select g.plan_id, m.id
    from public.platform_plan_product_grants g
    join public.platform_catalog_products wp on wp.id = g.product_id and wp.key = 'workspace'
    join public.platform_catalog_modules m on m.key = 'intelligence'
    join public.platform_catalog_products ap on ap.id = m.product_id and ap.key = 'agents'
  on conflict do nothing;

-- GOLD Internal grants every implemented capability, so it grants the two new Products whole.
insert into public.platform_plan_product_grants (plan_id, product_id)
  select pl.id, p.id
    from public.platform_plans pl
    cross join public.platform_catalog_products p
   where pl.key = 'gold_internal' and p.key in ('service', 'agents')
  on conflict do nothing;

comment on table public.platform_catalog_products is
  'The customer-facing catalogue: the eight Gild Products (kind = product) and, beneath them, the shared workspace capability (kind = workspace). Keys are locked; update_catalog_product changes presentation only.';
