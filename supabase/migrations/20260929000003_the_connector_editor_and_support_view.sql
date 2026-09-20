-- The staff doors onto the connector catalogue (D55), and staff's read of a tenant's connections.
--
-- **Every write is a narrow door**, `app.require_platform_staff()` inside it, the same shape as
-- `update_catalog_module`. No role holds a table grant on either connector table. A status edit
-- is the whole point of Slice 4 — "Notion: planned → beta → public" is a row, not a deployment —
-- and it changes nothing a business already recorded: `integration_connections` names a
-- connector by key and copies nothing from it.
--
-- **Logos are a public bucket, on `brand`'s reasoning** (`20260904000002`): a logo exists to be on
-- a page a stranger opens, so a signed URL would only make the marketing catalogue uncacheable.
-- What does not relax is who may write — platform staff alone, read live.
--
-- **A tenant's connections, for support, without a token.** Staff are a member of nothing (I21),
-- so `integration_connections` is invisible to them by policy. The door below returns what a
-- support person needs — which app, which account, status, scopes, when it was last proven — and
-- has no column that could carry a credential: `secret_id` is reduced to a boolean.

-- ---------------------------------------------------------------------------
-- The apps inside a suite
-- ---------------------------------------------------------------------------

create table public.platform_connector_apps (
  id            uuid    primary key default gen_random_uuid(),
  connector_id  uuid    not null references public.platform_connectors (id) on delete cascade,
  key           text    not null check (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  name          text    not null check (length(btrim(name)) between 1 and 120),
  description   text    not null default '' check (length(description) <= 300),
  display_order integer not null default 0,

  constraint platform_connector_apps_key_unique unique (connector_id, key)
);

comment on table public.platform_connector_apps is
  'One app inside a connector that is a suite — Google Workspace: Drive, Calendar, Gmail. The connection stays one authorization; this is what it can reach, as presentation.';

alter table public.platform_connector_apps enable row level security;
alter table public.platform_connector_apps force  row level security;

-- Reads the parent under the caller's own rights, so it is exactly as visible as its connector.
create policy platform_connector_apps_select on public.platform_connector_apps
  for select to authenticated
  using (exists (select 1 from public.platform_connectors c where c.id = connector_id));

grant select on public.platform_connector_apps to authenticated;

insert into public.platform_connector_apps (connector_id, key, name, description, display_order)
select c.id, a.key, a.name, a.description, a.ord
  from public.platform_connectors c
  join (values
    ('google_workspace', 'drive',    'Drive',    'Files and folders.', 1),
    ('google_workspace', 'calendar', 'Calendar', 'Events and availability.', 2),
    ('google_workspace', 'gmail',    'Gmail',    'Mail.', 3),
    ('google_workspace', 'docs',     'Docs',     'Documents.', 4),
    ('google_workspace', 'sheets',   'Sheets',   'Spreadsheets.', 5),
    ('microsoft_365',    'onedrive', 'OneDrive', 'Files and folders.', 1),
    ('microsoft_365',    'calendar', 'Calendar', 'Events and availability.', 2),
    ('microsoft_365',    'outlook',  'Outlook',  'Mail.', 3),
    ('microsoft_365',    'excel',    'Excel',    'Spreadsheets.', 4),
    ('microsoft_365',    'teams',    'Teams',    'Channels and messages.', 5)
  ) as a (connector_key, key, name, description, ord) on a.connector_key = c.key;

-- ---------------------------------------------------------------------------
-- Logos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('connector-logos', 'connector-logos', true, 1048576)
on conflict (id) do nothing;

create policy connector_logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'connector-logos' and app.is_platform_staff());

create policy connector_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'connector-logos' and app.is_platform_staff());

create policy connector_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'connector-logos' and app.is_platform_staff());

-- ---------------------------------------------------------------------------
-- The doors
-- ---------------------------------------------------------------------------

-- Insert-or-update by key. `key` is immutable once a row exists: a business's connections and a
-- marketing URL both hold it.
create function public.upsert_platform_connector(
  p_key                   text,
  p_name                  text,
  p_description           text,
  p_category              text,
  p_suite                 text,
  p_status                text,
  p_auth_method           text,
  p_connection_method     text,
  p_is_public             boolean,
  p_display_order         integer,
  p_icon_ref              text,
  p_marketing_slug        text,
  p_marketing_summary     text,
  p_marketing_description text,
  p_capabilities          text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform app.require_platform_staff();

  insert into public.platform_connectors as c (
    key, name, description, category, suite, status, auth_method, connection_method,
    is_public, display_order, icon_ref, marketing_slug, marketing_summary, marketing_description, capabilities
  ) values (
    p_key, btrim(p_name), coalesce(p_description, ''), btrim(p_category), nullif(btrim(coalesce(p_suite, '')), ''),
    p_status, p_auth_method, p_connection_method, p_is_public, p_display_order,
    nullif(btrim(coalesce(p_icon_ref, '')), ''), nullif(btrim(coalesce(p_marketing_slug, '')), ''),
    coalesce(p_marketing_summary, ''), coalesce(p_marketing_description, ''), coalesce(p_capabilities, '{}')
  )
  on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    suite = excluded.suite,
    status = excluded.status,
    auth_method = excluded.auth_method,
    connection_method = excluded.connection_method,
    is_public = excluded.is_public,
    display_order = excluded.display_order,
    icon_ref = excluded.icon_ref,
    marketing_slug = excluded.marketing_slug,
    marketing_summary = excluded.marketing_summary,
    marketing_description = excluded.marketing_description,
    capabilities = excluded.capabilities,
    updated_at = now()
  returning c.id into v_id;

  return v_id;
end;
$fn$;

comment on function public.upsert_platform_connector(text, text, text, text, text, text, text, text, boolean, integer, text, text, text, text, text[]) is
  'Staff-only write of one connector. key is immutable once it exists; nothing a business recorded is rewritten by an edit here (D55).';

revoke all on function public.upsert_platform_connector(text, text, text, text, text, text, text, text, boolean, integer, text, text, text, text, text[]) from public;
grant execute on function public.upsert_platform_connector(text, text, text, text, text, text, text, text, boolean, integer, text, text, text, text, text[]) to authenticated;

create function public.set_platform_connector_app(
  p_connector_key text,
  p_key           text,
  p_name          text,
  p_description   text,
  p_display_order integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_connector uuid;
begin
  perform app.require_platform_staff();

  select id into v_connector from public.platform_connectors where key = p_connector_key;
  if v_connector is null then
    raise exception 'no such connector: %', p_connector_key using errcode = '23503';
  end if;

  insert into public.platform_connector_apps (connector_id, key, name, description, display_order)
  values (v_connector, p_key, btrim(p_name), coalesce(p_description, ''), p_display_order)
  on conflict (connector_id, key) do update set
    name = excluded.name, description = excluded.description, display_order = excluded.display_order;
end;
$fn$;

revoke all on function public.set_platform_connector_app(text, text, text, text, integer) from public;
grant execute on function public.set_platform_connector_app(text, text, text, text, integer) to authenticated;

create function public.remove_platform_connector_app(p_connector_key text, p_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  delete from public.platform_connector_apps a
   using public.platform_connectors c
   where a.connector_id = c.id and c.key = p_connector_key and a.key = p_key;
end;
$fn$;

revoke all on function public.remove_platform_connector_app(text, text) from public;
grant execute on function public.remove_platform_connector_app(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Support's view of one business's connections — metadata, never a credential
-- ---------------------------------------------------------------------------

create function public.organization_integration_connections(p_organization_id uuid)
returns table (
  id               uuid,
  connector_key    text,
  connector_name   text,
  account_label    text,
  status           text,
  scopes           text[],
  has_credential   boolean,
  resource_count   bigint,
  last_verified_at timestamptz,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  return query
  select c.id, c.connector_key, coalesce(k.name, c.connector_key), c.account_label, c.status, c.scopes,
         c.secret_id is not null,
         (select count(*) from public.integration_resources r where r.connection_id = c.id),
         c.last_verified_at, c.created_at
    from public.integration_connections c
    left join public.platform_connectors k on k.key = c.connector_key
   where c.organization_id = p_organization_id
   order by c.created_at desc;
end;
$fn$;

comment on function public.organization_integration_connections(uuid) is
  'Platform staff''s read of one business''s connections: which app, which account, status, scopes, health. secret_id is reduced to a boolean and no credential is reachable through it (D55).';

revoke all on function public.organization_integration_connections(uuid) from public;
grant execute on function public.organization_integration_connections(uuid) to authenticated;
