-- The provider-service catalogue — a Provider is too coarse to say what GOLD actually uses.
--
-- **A fifth noun beside the four this repository already keeps apart (D54, D55).** A *provider*
-- (`platform_providers`) is who GOLD buys infrastructure from — a name, nothing else. A
-- *provider service* (this file) is one capability that provider exposes — Google is a provider;
-- Gemini Interactions, Routes and Weather are three of its services, each with its own upstream
-- state and its own place (or absence) in what GOLD runs. Conflating the two would make "Google"
-- mean Gemini and Routes and Trends all at once, which is exactly the coarseness this closes.
--
-- **Four facts, never collapsed into one status column (section 2).** `implementation_state` is
-- what GOLD runs — the same three-value vocabulary `platform_catalog_features.implementation_state`
-- already uses, so "planned" means the same thing in both tables. `vendor_status` is the upstream
-- service's own maturity — generally available, preview, restricted, or a service on its way out
-- — and is entirely independent: Gemini Managed Agents can be a real upstream preview while GOLD
-- has not written a line against it, and Anthropic's Messages API can be generally available while
-- also the one GOLD actually calls. A credential's presence and a service's operational health are
-- narrower facts still and are not modelled here at all — they belong to the account/binding a
-- service's `auth_mode` implies, not to the catalogue row.
--
-- **A mapping is a description, never a grant (section 4).** `platform_provider_service_features`
-- and `platform_connector_app_features` answer "this external capability can support this GOLD
-- Feature", not "this tenant owns it" — commercial truth stays in `platform_plan_*_grants`,
-- entirely untouched by anything in this file. Real foreign keys throughout, on `platform_catalog_
-- runtime_mappings`' own advice: that table's `provider_key` mapping kind is free text with no FK,
-- fine for the coarse "which provider" fact a Feature already carries, but not narrow enough for
-- "which of that provider's dozen services" without either an ambiguous composite string or a
-- broken reference — so this adds two narrow tables instead of overloading the wide one.
--
-- **Seed truth, not aspiration (section 53).** Every row below is real: the provider exists, the
-- service exists upstream, and `implementation_state` says plainly that almost none of it runs in
-- GOLD yet. A service seeded here and never called by any adapter is exactly as honest as a
-- `planned` Feature — a catalogue entry, not a promise.

-- ---------------------------------------------------------------------------
-- 1. Providers this deployment actually names
-- ---------------------------------------------------------------------------

insert into public.platform_providers (key, label) values
  ('google', 'Google'),
  ('openai', 'OpenAI')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Provider services
-- ---------------------------------------------------------------------------

create table public.platform_provider_services (
  id                    uuid        primary key default gen_random_uuid(),
  provider_key          text        not null references public.platform_providers (key),
  key                   text        not null check (key ~ '^[a-z][a-z0-9_]{0,60}$'),
  label                 text        not null check (length(btrim(label)) between 1 and 160),
  description           text        not null default '' check (length(description) <= 500),

  -- A UI grouping, open vocabulary like platform_connectors.category — not a closed list, because
  -- a provider's own product lines are not this schema's to enumerate in a CHECK.
  family                text        not null check (length(btrim(family)) between 1 and 60),
  kind                  text        not null check (kind in ('runtime', 'data', 'infrastructure', 'distribution')),

  -- What GOLD runs. The same vocabulary platform_catalog_features.implementation_state carries,
  -- deliberately: "planned" means the identical thing in both tables.
  implementation_state  text        not null check (implementation_state in ('planned', 'partial', 'available')),
  -- The upstream service's own maturity — independent of whether GOLD has written a line against
  -- it. 'legacy' is for a surface the vendor is retiring (OpenAI's Legacy GPT Actions), not for
  -- anything GOLD has deprecated, which implementation_state already has no word for either.
  vendor_status         text        not null check (vendor_status in ('generally_available', 'preview', 'restricted', 'legacy')),
  -- How a call to this service would authenticate, once one exists. Not a claim that GOLD holds
  -- a credential — see platform_provider_accounts for that, a wholly separate table this one
  -- carries no reference to.
  auth_mode             text        not null check (auth_mode in ('none', 'api_key', 'oauth2', 'account_credential')),

  docs_url              text        check (docs_url is null or length(docs_url) <= 500),
  display_order         integer     not null default 0,

  -- Free-form, staff-written notes a typed column would be premature for — the map-rendering
  -- policy boundary (section 46) lives here rather than as a dedicated column no other row needs.
  metadata              jsonb       not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint platform_provider_services_key_unique unique (provider_key, key)
);

comment on table public.platform_provider_services is
  'One capability a Provider exposes — Google is a provider; Gemini Interactions and Routes are two of its services. implementation_state is what GOLD runs; vendor_status is the upstream service''s own maturity; the two are never collapsed into one column (section 2).';

alter table public.platform_provider_services enable row level security;
alter table public.platform_provider_services force  row level security;

create policy platform_provider_services_select on public.platform_provider_services
  for select to authenticated using (true);

grant select on public.platform_provider_services to authenticated;
-- No insert/update/delete grant to any role: upsert_platform_provider_service is the only door.

create table public.platform_provider_service_features (
  provider_service_id uuid        not null references public.platform_provider_services (id) on delete cascade,
  feature_id           uuid        not null references public.platform_catalog_features (id) on delete cascade,
  relationship          text        not null default 'supports' check (relationship in ('supports')),
  note                  text        not null default '' check (length(note) <= 300),
  created_at            timestamptz not null default now(),

  primary key (provider_service_id, feature_id)
);

comment on table public.platform_provider_service_features is
  'A provider service can support a GOLD Feature — a description, never an entitlement grant (section 4). Plan/Add-on grants in platform_plan_*_grants remain the only commercial truth; nothing here is read by resolveServiceAccess or any entitlement check.';

alter table public.platform_provider_service_features enable row level security;
alter table public.platform_provider_service_features force  row level security;

create policy platform_provider_service_features_select on public.platform_provider_service_features
  for select to authenticated using (true);

grant select on public.platform_provider_service_features to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Connector apps grow the same two implementation facts, and their own mapping table
-- ---------------------------------------------------------------------------

alter table public.platform_connector_apps
  add column implementation_state text not null default 'planned'
                                     check (implementation_state in ('planned', 'partial', 'available')),
  add column vendor_status        text check (vendor_status in ('generally_available', 'preview', 'restricted', 'legacy')),
  add column docs_url             text check (docs_url is null or length(docs_url) <= 500);

comment on table public.platform_connector_apps is
  'One app inside a connector that is a suite — Google Workspace: Drive, Calendar, Gmail. The connection stays one authorization; this is what it can reach, as presentation, now carrying its own implementation/vendor truth (section 11) rather than inheriting the parent connector''s.';

create table public.platform_connector_app_features (
  connector_app_id uuid        not null references public.platform_connector_apps (id) on delete cascade,
  feature_id        uuid        not null references public.platform_catalog_features (id) on delete cascade,
  relationship       text        not null default 'supports' check (relationship in ('supports')),
  note               text        not null default '' check (length(note) <= 300),
  created_at         timestamptz not null default now(),

  primary key (connector_app_id, feature_id)
);

comment on table public.platform_connector_app_features is
  'A connector app can support a GOLD Feature — the same descriptive-only relationship platform_provider_service_features carries, for the other external-capability axis. Unrelated to the CSV MappingEditor''s source-field-to-GOLD-field mapping (section 36), which shares nothing but the word.';

alter table public.platform_connector_app_features enable row level security;
alter table public.platform_connector_app_features force  row level security;

create policy platform_connector_app_features_select on public.platform_connector_app_features
  for select to authenticated using (true);

grant select on public.platform_connector_app_features to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The narrow doors — staff alone, exactly platform_connectors' own shape
-- ---------------------------------------------------------------------------

create function public.upsert_platform_provider_service(
  p_provider_key         text,
  p_key                  text,
  p_label                text,
  p_description          text,
  p_family               text,
  p_kind                 text,
  p_implementation_state text,
  p_vendor_status        text,
  p_auth_mode            text,
  p_docs_url             text,
  p_display_order        integer,
  p_metadata             jsonb
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

  insert into public.platform_provider_services as s (
    provider_key, key, label, description, family, kind,
    implementation_state, vendor_status, auth_mode, docs_url, display_order, metadata
  ) values (
    p_provider_key, p_key, btrim(p_label), coalesce(p_description, ''), btrim(p_family), p_kind,
    p_implementation_state, p_vendor_status, p_auth_mode,
    nullif(btrim(coalesce(p_docs_url, '')), ''), p_display_order, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider_key, key) do update set
    label = excluded.label,
    description = excluded.description,
    family = excluded.family,
    kind = excluded.kind,
    implementation_state = excluded.implementation_state,
    vendor_status = excluded.vendor_status,
    auth_mode = excluded.auth_mode,
    docs_url = excluded.docs_url,
    display_order = excluded.display_order,
    metadata = excluded.metadata,
    updated_at = now()
  returning s.id into v_id;

  return v_id;
end;
$fn$;

comment on function public.upsert_platform_provider_service(text, text, text, text, text, text, text, text, text, text, integer, jsonb) is
  'Staff-only write of one provider service. (provider_key, key) is immutable once it exists; provider_key must already be a row in platform_providers.';

revoke all on function public.upsert_platform_provider_service(text, text, text, text, text, text, text, text, text, text, integer, jsonb) from public;
grant execute on function public.upsert_platform_provider_service(text, text, text, text, text, text, text, text, text, text, integer, jsonb) to authenticated;

create function public.set_provider_service_feature(
  p_provider_service_id uuid,
  p_feature_id           uuid,
  p_relationship         text default 'supports',
  p_note                 text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  insert into public.platform_provider_service_features (provider_service_id, feature_id, relationship, note)
  values (p_provider_service_id, p_feature_id, p_relationship, coalesce(p_note, ''))
  on conflict (provider_service_id, feature_id) do update set
    relationship = excluded.relationship, note = excluded.note;
end;
$fn$;

revoke all on function public.set_provider_service_feature(uuid, uuid, text, text) from public;
grant execute on function public.set_provider_service_feature(uuid, uuid, text, text) to authenticated;

create function public.remove_provider_service_feature(p_provider_service_id uuid, p_feature_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  delete from public.platform_provider_service_features
   where provider_service_id = p_provider_service_id and feature_id = p_feature_id;
end;
$fn$;

revoke all on function public.remove_provider_service_feature(uuid, uuid) from public;
grant execute on function public.remove_provider_service_feature(uuid, uuid) to authenticated;

create function public.set_connector_app_feature(
  p_connector_app_id uuid,
  p_feature_id        uuid,
  p_relationship      text default 'supports',
  p_note              text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  insert into public.platform_connector_app_features (connector_app_id, feature_id, relationship, note)
  values (p_connector_app_id, p_feature_id, p_relationship, coalesce(p_note, ''))
  on conflict (connector_app_id, feature_id) do update set
    relationship = excluded.relationship, note = excluded.note;
end;
$fn$;

revoke all on function public.set_connector_app_feature(uuid, uuid, text, text) from public;
grant execute on function public.set_connector_app_feature(uuid, uuid, text, text) to authenticated;

create function public.remove_connector_app_feature(p_connector_app_id uuid, p_feature_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  delete from public.platform_connector_app_features
   where connector_app_id = p_connector_app_id and feature_id = p_feature_id;
end;
$fn$;

revoke all on function public.remove_connector_app_feature(uuid, uuid) from public;
grant execute on function public.remove_connector_app_feature(uuid, uuid) to authenticated;

-- set_platform_connector_app grows the same three columns. Dropped and recreated rather than
-- CREATE OR REPLACE, which cannot add parameters to an existing signature without leaving the old
-- one callable alongside it.
drop function public.set_platform_connector_app(text, text, text, text, integer);

create function public.set_platform_connector_app(
  p_connector_key        text,
  p_key                  text,
  p_name                 text,
  p_description          text,
  p_display_order        integer,
  p_implementation_state text default 'planned',
  p_vendor_status        text default null,
  p_docs_url             text default null
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

  insert into public.platform_connector_apps (
    connector_id, key, name, description, display_order, implementation_state, vendor_status, docs_url
  )
  values (
    v_connector, p_key, btrim(p_name), coalesce(p_description, ''), p_display_order,
    coalesce(p_implementation_state, 'planned'), p_vendor_status, nullif(btrim(coalesce(p_docs_url, '')), '')
  )
  on conflict (connector_id, key) do update set
    name = excluded.name,
    description = excluded.description,
    display_order = excluded.display_order,
    implementation_state = excluded.implementation_state,
    vendor_status = excluded.vendor_status,
    docs_url = excluded.docs_url;
end;
$fn$;

comment on function public.set_platform_connector_app(text, text, text, text, integer, text, text, text) is
  'Staff-only write of one connector app. Grew implementation_state/vendor_status/docs_url in the provider-service-catalogue slice (section 11); the three default so an existing caller passing only the first five arguments keeps working.';

revoke all on function public.set_platform_connector_app(text, text, text, text, integer, text, text, text) from public;
grant execute on function public.set_platform_connector_app(text, text, text, text, integer, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. New Connector rows — Google products that are a tenant's own authorization, never a
--    Provider Service GOLD operates on the tenant's behalf (section 12)
-- ---------------------------------------------------------------------------

insert into public.platform_connectors
  (key, name, description, category, suite, status, auth_method, connection_method, is_public, display_order, capabilities)
values
  ('google_business_profile', 'Google Business Profile', 'Listings, reviews, posts and performance for a business''s Google presence.', 'Marketing', null, 'planned', 'oauth2', 'native', true, 110, array['app_connections']),
  ('google_ads',               'Google Ads',              'Campaigns, conversions and ad performance.',                                  'Marketing', null, 'planned', 'oauth2', 'native', true, 120, array['app_connections', 'scheduled_sync']),
  ('google_analytics',         'Google Analytics',        'Website and funnel analytics.',                                               'Marketing', null, 'planned', 'oauth2', 'native', true, 130, array['app_connections', 'scheduled_sync']),
  ('google_search_console',    'Google Search Console',   'Search performance for a business''s own site.',                              'Marketing', null, 'planned', 'oauth2', 'native', true, 140, array['app_connections']),
  ('youtube',                  'YouTube',                 'Videos and channel performance.',                                             'Marketing', null, 'planned', 'oauth2', 'native', true, 150, array['app_connections']);

-- ---------------------------------------------------------------------------
-- 6. Google Workspace's suite, substantially expanded (section 10)
-- ---------------------------------------------------------------------------

-- The five apps seeded in 20260929000003 stay, and gain the two new facts. None sync today, so
-- every one — new or old — is 'planned'.
update public.platform_connector_apps a
   set implementation_state = 'planned', vendor_status = 'generally_available'
  from public.platform_connectors c
 where a.connector_id = c.id and c.key = 'google_workspace';

update public.platform_connector_apps a
   set implementation_state = 'planned', vendor_status = 'generally_available'
  from public.platform_connectors c
 where a.connector_id = c.id and c.key = 'microsoft_365';

insert into public.platform_connector_apps (connector_id, key, name, description, display_order, implementation_state, vendor_status)
select c.id, w.key, w.name, w.description, w.ord, 'planned', 'generally_available'
  from public.platform_connectors c
  join (values
    ('admin_sdk',         'Admin SDK',          'Directory, users and organizational settings for a Workspace domain.', 6),
    ('apps_script',       'Apps Script',         'Custom scripts and automations bound to a Workspace app.', 7),
    ('chat',              'Chat',                'Spaces and messages.', 8),
    ('classroom',         'Classroom',           'Courses, coursework and rosters.', 9),
    ('drive_activity',    'Drive Activity',      'Who did what to a file, and when.', 10),
    ('forms',             'Forms',               'Forms and their responses.', 11),
    ('keep',               'Keep',                'Notes and lists.', 12),
    ('meet',              'Meet',                'Meetings and their recordings.', 13),
    ('people',            'People',              'Contacts and directory profiles.', 14),
    ('tasks',             'Tasks',               'Task lists.', 15),
    ('workspace_events',  'Workspace Events',    'Push notifications when something changes in another Workspace app — an event capability, not a scheduled sync (section 13).', 16),
    ('cloud_search',      'Cloud Search',        'Search across a domain''s Workspace content.', 17),
    ('picker',            'Picker',              'A file-selection UI a business''s own Drive content can be chosen through.', 18),
    ('workspace_add_ons', 'Workspace Add-ons',   'Extensions that run inside Gmail, Calendar, Docs, Sheets or Slides.', 19)
  ) as w (key, name, description, ord) on true
 where c.key = 'google_workspace';

-- ---------------------------------------------------------------------------
-- 7. Provider service seed — every row real, implementation_state told straight (section 53)
-- ---------------------------------------------------------------------------

insert into public.platform_provider_services
  (provider_key, key, label, description, family, kind, implementation_state, vendor_status, auth_mode, display_order, metadata)
values
  -- Google — AI
  ('google', 'gemini_interactions',   'Gemini Interactions API', 'Google''s recommended API surface for new Gemini work — text, structured output and tool use.', 'AI', 'runtime', 'planned', 'generally_available', 'api_key', 10, '{}'),
  ('google', 'gemini_live',           'Gemini Live',             'Realtime, low-latency multimodal conversation.',                                                  'AI', 'runtime', 'planned', 'preview',             'api_key', 20, '{}'),
  ('google', 'gemini_embeddings',     'Gemini Embeddings',       'Vector embeddings for retrieval and similarity.',                                                  'AI', 'runtime', 'planned', 'generally_available', 'api_key', 30, '{}'),
  ('google', 'gemini_managed_agents', 'Gemini Managed Agents',   'Upstream-hosted, long-running agent execution.',                                                   'AI', 'runtime', 'planned', 'preview',             'api_key', 40, '{}'),
  ('google', 'gemini_gems',           'Gemini Gems',             'A user-facing Gemini product-configuration surface, not a programmable service (section 18).',    'AI', 'distribution', 'planned', 'restricted', 'none', 50,
    '{"note": "No official API to create, edit or deploy a Gem exists; any future export produces instructions/knowledge/starter prompts a person pastes in by hand, never a Connect or Deploy action."}'),

  -- Google — Maps / Field
  ('google', 'places',              'Places',              'Place search and details for address/place autocomplete.',                    'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 60, '{}'),
  ('google', 'geocoding',            'Geocoding',            'Address to coordinates, and back.',                                            'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 70, '{}'),
  ('google', 'address_validation',   'Address Validation',   'Whether a typed address is deliverable, and its corrected form.',              'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 80, '{}'),
  ('google', 'routes',               'Routes',               'Travel time and distance between two or more points.',                        'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 90,
    '{"map_rendering": "Route geometry from this service carries Google Maps Platform display/attribution restrictions and must not be drawn on the MapLibre surface (mapConfig()) without a separate policy decision — section 8/46."}'),
  ('google', 'route_optimization',   'Route Optimization',   'Multi-stop sequencing and assignment across resources.',                      'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 100,
    '{"map_rendering": "Same restriction as Routes — its output is scheduling data, not a MapLibre layer, until that is decided separately."}'),
  ('google', 'time_zone',            'Time Zone',            'The IANA zone for a point on the map.',                                        'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 110, '{}'),
  ('google', 'roads',                'Roads',                'Snapping raw GPS points to the road network.',                                 'Field', 'infrastructure', 'planned', 'generally_available', 'api_key', 120, '{}'),
  ('google', 'weather',              'Weather',               'Current and forecast conditions at a point.',                                  'Field', 'data',           'planned', 'preview',             'api_key', 130, '{}'),
  ('google', 'air_quality',          'Air Quality',           'Current and forecast air-quality index at a point.',                           'Field', 'data',           'planned', 'generally_available', 'api_key', 140, '{}'),
  ('google', 'pollen',               'Pollen',                'Pollen forecast at a point.',                                                  'Field', 'data',           'planned', 'generally_available', 'api_key', 150, '{}'),
  ('google', 'elevation',            'Elevation',             'Height above sea level at a point.',                                           'Field', 'data',           'planned', 'generally_available', 'api_key', 160, '{}'),

  -- Google — Data / market signals
  ('google', 'trends', 'Trends API', 'Search-interest signals over time and geography.', 'Data', 'data', 'planned', 'restricted', 'api_key', 170,
    '{"note": "Limited alpha/restricted access upstream at the time this was catalogued — never scraped, never shown as Available/Connect/Ready merely because the row exists (section 9)."}'),

  -- OpenAI — AI runtime
  ('openai', 'responses',         'Responses API',              'Text, structured output, built-in tools, MCP tools and custom function calls in one surface (section 15).', 'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 10, '{}'),
  ('openai', 'realtime',          'Realtime',                   'Realtime, low-latency voice conversation.',                                    'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 20, '{}'),
  ('openai', 'embeddings',        'Embeddings',                  'Vector embeddings for retrieval and similarity.',                              'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 30, '{}'),
  ('openai', 'speech_generation', 'Speech generation',          'Text to spoken audio.',                                                        'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 40, '{}'),
  ('openai', 'transcription',     'Transcription',              'Spoken audio to text.',                                                        'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 50, '{}'),
  ('openai', 'image_generation',  'Image generation/editing',   'Text-to-image and image editing.',                                             'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 60, '{}'),
  ('openai', 'moderation',        'Moderation',                  'Classifying content against a safety policy.',                                 'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 70, '{}'),
  ('openai', 'batch',             'Batch',                       'Large asynchronous request batches at a lower cost.',                          'AI Runtime', 'runtime', 'planned', 'generally_available', 'api_key', 80, '{}'),

  -- OpenAI — Distribution (custom GPTs are retiring; do not build against them — section 16/17)
  ('openai', 'chatgpt_plugins',    'ChatGPT Plugins',    'The current, preferred way to expose a tool to ChatGPT.',                                        'Distribution', 'distribution', 'planned', 'generally_available', 'oauth2', 90, '{}'),
  ('openai', 'legacy_gpt_actions', 'Legacy GPT Actions', 'An OpenAPI schema a custom GPT could call — transitional, on its way out, never GOLD''s future agent architecture.', 'Distribution', 'distribution', 'planned', 'legacy', 'none', 100,
    '{"note": "A Legacy GPT Action definition is an OpenAPI document describing an external API, not a complete GPT configuration (section 17). No exporter exists; one would need Gild Agents'' own tool contract audited first."}'),

  -- Anthropic — the one provider with real runtime behind it today
  ('anthropic', 'messages', 'Messages API', 'Text, structured output and tool use — what drafts a configuration proposal (apps/web/lib/adapters/drafting) and answers/reasons through the AI tool loop (apps/api/app/ai, apps/api/app/providers/anthropic).', 'AI Runtime', 'runtime', 'available', 'generally_available', 'api_key', 10, '{}'),

  -- Twilio — provider services beside the existing meter/rate/account model, at finer grain
  ('twilio', 'voice',     'Voice',     'Inbound and outbound calling — comms.voice''s inbound_calling/outbound_calling are both available.', 'Telephony', 'infrastructure', 'available', 'generally_available', 'account_credential', 10, '{}'),
  ('twilio', 'messaging', 'Messaging', 'SMS. The catalogue''s own inbound_sms/outbound_sms Features are still planned, so this matches rather than overclaiming.', 'Telephony', 'infrastructure', 'planned', 'generally_available', 'account_credential', 20, '{}'),
  ('twilio', 'whatsapp',  'WhatsApp',  'WhatsApp messaging.',                                                                                    'Telephony', 'infrastructure', 'planned', 'generally_available', 'account_credential', 30, '{}');

-- ---------------------------------------------------------------------------
-- 8. Feature mappings — only where an authoritative Catalog Feature already exists
-- ---------------------------------------------------------------------------

insert into public.platform_provider_service_features (provider_service_id, feature_id, relationship)
select ps.id, f.id, 'supports'
  from (values
    ('google',    'gemini_interactions',   'agents', 'tools',              'agent_tools'),
    ('google',    'gemini_interactions',   'agents', 'intelligence',       'ask_gold'),
    ('google',    'gemini_embeddings',     'agents', 'tools',              'agent_tools'),
    ('google',    'gemini_managed_agents', 'agents', 'tools',              'agent_tools'),
    ('google',    'gemini_live',           'comms',  'voice',              'ai_receptionist'),
    ('google',    'routes',                'field',  'dispatch',           'geographic_routing'),
    ('google',    'route_optimization',    'field',  'dispatch',           'geographic_routing'),
    ('google',    'weather',               'field',  'dispatch',           'weather_aware_dispatch'),
    ('google',    'air_quality',           'field',  'dispatch',           'weather_aware_dispatch'),
    ('google',    'geocoding',             'field',  'assets_locations',   'locations'),
    ('google',    'places',                'field',  'assets_locations',   'locations'),
    ('google',    'address_validation',    'field',  'assets_locations',   'locations'),
    ('openai',    'responses',             'agents', 'tools',              'agent_tools'),
    ('openai',    'responses',             'agents', 'intelligence',       'ask_gold'),
    ('openai',    'embeddings',            'agents', 'tools',              'agent_tools'),
    ('openai',    'realtime',              'comms',  'voice',              'ai_receptionist'),
    ('openai',    'speech_generation',     'comms',  'voice',              'ai_receptionist'),
    ('openai',    'transcription',         'comms',  'voice',              'transcription'),
    ('anthropic', 'messages',              'agents', 'intelligence',       'ask_gold'),
    ('anthropic', 'messages',              'agents', 'tools',              'agent_tools'),
    ('twilio',    'voice',                 'comms',  'voice',              'inbound_calling'),
    ('twilio',    'voice',                 'comms',  'voice',              'outbound_calling'),
    ('twilio',    'messaging',             'comms',  'sms',                'inbound_sms'),
    ('twilio',    'messaging',             'comms',  'sms',                'outbound_sms')
  ) as v (provider_key, service_key, product_key, module_key, feature_key)
  join public.platform_provider_services ps on ps.provider_key = v.provider_key and ps.key = v.service_key
  join public.platform_catalog_modules m on m.key = v.module_key
  join public.platform_catalog_products p on p.id = m.product_id and p.key = v.product_key
  join public.platform_catalog_features f on f.module_id = m.id and f.key = v.feature_key;

insert into public.platform_connector_app_features (connector_app_id, feature_id, relationship)
select ca.id, f.id, 'supports'
  from (values
    ('google_workspace', 'calendar', 'field', 'scheduling',          'availability'),
    ('google_workspace', 'sheets',   'sales',  'data',                'file_imports'),
    ('google_workspace', 'sheets',   'sales',  'data',                'data_mapping'),
    ('google_workspace', 'forms',    'studio', 'forms_intake',        'contact_forms'),
    ('google_workspace', 'people',   'sales',  'customers_contacts',  'contacts')
  ) as v (connector_key, app_key, product_key, module_key, feature_key)
  join public.platform_connectors c on c.key = v.connector_key
  join public.platform_connector_apps ca on ca.connector_id = c.id and ca.key = v.app_key
  join public.platform_catalog_modules m on m.key = v.module_key
  join public.platform_catalog_products p on p.id = m.product_id and p.key = v.product_key
  join public.platform_catalog_features f on f.module_id = m.id and f.key = v.feature_key;
