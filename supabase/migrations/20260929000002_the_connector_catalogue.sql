-- The connector catalogue — which outside apps GOLD knows about, as data.
--
-- **Three nouns, kept apart (D54, one more).** A *provider* (`platform_providers`) is who GOLD
-- buys infrastructure from: Twilio, Resend. A *connector* (this file) is an outside app a
-- *business* may authorize: Google Workspace, HubSpot, a CSV file. An *integration connection*
-- (`integration_connections`, D33) is one business's actual authorization to one connector. The
-- connector answers "what exists"; the connection answers "what this business has done about it".
-- Merging the first two would put a wholesale runtime vendor on a tenant's Browse screen; merging
-- the last two would make a catalogue edit rewrite a business's own record.
--
-- **Status is the truth about the runtime, never the marketing.** `planned` is a real row with no
-- Connect action anywhere; the same rule `platform_catalog_features.implementation_state` holds.
-- The enforcement is the tenant *insert policy* below, not a screen that hides a button: a
-- connection to a planned or private connector is refused by the table.
--
-- **Two descriptions, on purpose.** `description` is what a signed-in business reads inside the
-- product; `marketing_summary`/`marketing_description` are public copy an admin may edit without
-- changing anything that runs.
--
-- There is no write door yet. Rows arrive by seed; `upsert_platform_connector` arrives with the
-- Platform → Integrations editor that calls it, and not before.

create table public.platform_connectors (
  id                    uuid        primary key default gen_random_uuid(),

  -- Open vocabulary, the same regex `integration_connections.connector_key` already carries.
  key                   text        not null unique check (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  name                  text        not null check (length(btrim(name)) between 1 and 120),
  description           text        not null default '' check (length(description) <= 500),

  -- A label an admin edits, not a closed list: the tenant's filter chips are read from what exists.
  category              text        not null check (length(btrim(category)) between 1 and 60),
  -- The family a connector belongs to when one authorization covers several apps (Google
  -- Workspace: Gmail, Drive, Calendar). Null for a connector that stands alone.
  suite                 text        check (suite is null or length(btrim(suite)) between 1 and 60),

  status                text        not null default 'planned'
                                      check (status in ('planned', 'beta', 'live')),
  auth_method           text        not null check (auth_method in ('none', 'oauth2', 'api_key')),
  connection_method     text        not null check (connection_method in ('native', 'mcp', 'automation', 'file', 'custom')),

  -- Private: a staff-only row — visible to no tenant and to the public. Public: browsable by
  -- every signed-in business, and the only rows a published catalogue may ever draw on.
  is_public             boolean     not null default false,
  display_order         integer     not null default 0,

  -- A reference to a stored image, never the bytes; how it is stored arrives with the editor.
  icon_ref              text        check (icon_ref is null or length(icon_ref) <= 500),

  marketing_slug        text        unique check (marketing_slug is null or marketing_slug ~ '^[a-z][a-z0-9-]{0,60}$'),
  marketing_summary     text        not null default '' check (length(marketing_summary) <= 200),
  marketing_description text        not null default '' check (length(marketing_description) <= 4000),

  -- Which of GOLD's own integration capabilities this connector takes part in. The names are the
  -- catalogue Feature keys under CRM → Data, so a connector's promise and a Plan's grant use one
  -- vocabulary.
  capabilities          text[]      not null default '{}'::text[]
                                      check (capabilities <@ array[
                                        'app_connections', 'file_imports', 'data_mapping',
                                        'scheduled_sync', 'triggers_actions', 'agent_tools'
                                      ]::text[]),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.platform_connectors is
  'The connector catalogue: outside apps a business may authorize, as data. Never a provider (platform_providers) and never a business''s own authorization (integration_connections). status = planned is a real row with no Connect action, enforced by integration_connections_insert.';

alter table public.platform_connectors enable row level security;
alter table public.platform_connectors force  row level security;

-- Public rows to every signed-in caller; every row to platform staff, read live (D45).
create policy platform_connectors_select on public.platform_connectors
  for select to authenticated
  using (is_public or app.is_platform_staff());

grant select on public.platform_connectors to authenticated;
-- No insert/update/delete grant to any role: staff writes are a narrow door, added with its caller.

-- ---------------------------------------------------------------------------
-- The seed. Every one is real; only `csv` is `live`, because only `csv` runs.
-- ---------------------------------------------------------------------------

insert into public.platform_connectors
  (key, name, description, category, suite, status, auth_method, connection_method, is_public, display_order, capabilities)
values
  ('csv',              'CSV / spreadsheet file', 'Upload an exported file — there is no account to connect.',           'Files',        null,               'live',    'none',   'file',   true, 10, array['file_imports', 'data_mapping']),
  ('google_workspace', 'Google Workspace',       'Drive, Calendar, Gmail, Docs and Sheets through one Google sign-in.',  'Productivity', 'Google Workspace', 'planned', 'oauth2', 'native', true, 20, array['app_connections', 'data_mapping', 'scheduled_sync']),
  ('microsoft_365',    'Microsoft 365',          'OneDrive, Outlook, Calendar, Excel and Teams through one Microsoft sign-in.', 'Productivity', 'Microsoft 365', 'planned', 'oauth2', 'native', true, 30, array['app_connections', 'data_mapping', 'scheduled_sync']),
  ('notion',           'Notion',                 'Workspaces, pages and databases.',                                     'Productivity', null,               'planned', 'oauth2', 'native', true, 40, array['app_connections', 'data_mapping']),
  ('slack',            'Slack',                  'Post to a channel when something happens in GOLD.',                    'Communication', null,              'planned', 'oauth2', 'native', true, 50, array['app_connections', 'triggers_actions']),
  ('dropbox',          'Dropbox',                'Files and folders.',                                                   'Files',        null,               'planned', 'oauth2', 'native', true, 60, array['app_connections', 'file_imports']),
  ('hubspot',          'HubSpot',                'Contacts, companies and sales pipelines.',                             'CRM',          null,               'planned', 'oauth2', 'native', true, 70, array['app_connections', 'data_mapping', 'scheduled_sync']),
  ('salesforce',       'Salesforce',             'Contacts, accounts and opportunities.',                                'CRM',          null,               'planned', 'oauth2', 'native', true, 80, array['app_connections', 'data_mapping', 'scheduled_sync']),
  ('quickbooks',       'QuickBooks',             'Customers, invoices and accounts.',                                    'Accounting',   null,               'planned', 'oauth2', 'native', true, 90, array['app_connections', 'data_mapping', 'scheduled_sync']),
  ('shopify',          'Shopify',                'Customers, orders and products.',                                      'Commerce',     null,               'planned', 'oauth2', 'native', true, 100, array['app_connections', 'data_mapping', 'scheduled_sync']);

-- A connection a business already holds to a key nobody seeded stays valid: it becomes a private
-- planned row rather than a foreign key that cannot be added. On a fresh database this inserts
-- nothing.
insert into public.platform_connectors (key, name, category, status, auth_method, connection_method, is_public)
select distinct c.connector_key, c.connector_key, 'Other', 'planned', 'none', 'custom', false
  from public.integration_connections c
 where not exists (select 1 from public.platform_connectors p where p.key = c.connector_key);

alter table public.integration_connections
  add constraint integration_connections_connector_fk
  foreign key (connector_key) references public.platform_connectors (key);

-- ---------------------------------------------------------------------------
-- A connection may only be made to a connector the caller can see and that runs
-- ---------------------------------------------------------------------------

-- The subquery reads `platform_connectors` under the caller's own rights, so a private row is
-- simply not there for a business; and a `planned` row is there but fails the second test.
drop policy integration_connections_insert on public.integration_connections;

create policy integration_connections_insert on public.integration_connections
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and connected_by = (select auth.uid())
    and app.has_capability(organization_id, 'integration.manage')
    and exists (
      select 1 from public.platform_connectors c
       where c.key = integration_connections.connector_key
         and c.status in ('beta', 'live')
    )
  );

-- ---------------------------------------------------------------------------
-- The catalogue Feature vocabulary: external connectivity, not only "import customers"
-- ---------------------------------------------------------------------------

update public.platform_catalog_modules
   set description = 'Custom fields, views, and connecting GOLD to the apps and files a business already uses.'
 where key = 'data'
   and product_id = (select id from public.platform_catalog_products where key = 'crm');

-- `csv_import` names one connector; the capability is importing a file. Grants and runtime
-- mappings reference the row by id, so the rename carries every one of them with it.
update public.platform_catalog_features f
   set key = 'file_imports',
       label = 'File imports',
       description = 'Bring records in from a spreadsheet or exported file.'
  from public.platform_catalog_modules m
 where f.module_id = m.id and m.key = 'data' and f.key = 'csv_import';

do $$
declare
  v_mod  uuid;
  v_feat uuid;
begin
  select m.id into v_mod
    from public.platform_catalog_modules m
    join public.platform_catalog_products p on p.id = m.product_id
   where p.key = 'crm' and m.key = 'data';

  insert into public.platform_catalog_features
    (module_id, key, label, description, implementation_state, packaging_default, ai_powered, display_order)
  values
    (v_mod, 'app_connections',  'App connections',  'Authorize an outside app once and see what it can reach.',              'partial', 'optional', false, 6),
    (v_mod, 'data_mapping',     'Data mapping',     'Review how an outside field lands on a GOLD field before anything is written.', 'available', 'optional', false, 7),
    (v_mod, 'scheduled_sync',   'Scheduled sync',   'Keep an outside app and GOLD in step on a schedule.',                   'planned', 'add_on',   false, 8),
    (v_mod, 'triggers_actions', 'Triggers and actions', 'Start or finish a GOLD rule in an outside app.',                    'planned', 'optional', false, 9),
    (v_mod, 'agent_tools',      'Agent tools',      'Let GOLD''s assistant reach an outside app through a permissioned tool.', 'planned', 'add_on',   true,  10);

  -- Runtime mappings only for what runs: a planned Feature has nothing to map onto yet.
  for v_feat in
    select id from public.platform_catalog_features
     where module_id = v_mod and key in ('app_connections', 'data_mapping')
  loop
    insert into public.platform_catalog_runtime_mappings (feature_id, mapping_kind, mapping_value, note)
    values (v_feat, 'module_key', 'integrations', '');
  end loop;
end
$$;
