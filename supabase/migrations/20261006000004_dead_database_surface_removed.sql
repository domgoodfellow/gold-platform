-- Functions with no caller in SQL, TypeScript, Python or any registry. Each was reachable by a
-- signed-in role and did something, which is the reason to remove them and not only to ignore them.

-- A business's own secret is written by the machine role that proved the caller (D56):
-- `store_integration_credential`. This older door let a signed-in role write one directly, and
-- nothing calls it.
drop function public.store_integration_secret(uuid, uuid, text);

-- The string bridge between the legacy and canonical catalogues, whose replacement by real
-- foreign keys is the catalogue slice. Nothing writes a mapping at runtime; they are seeded.
drop function public.add_runtime_mapping(uuid, text, text, text);
drop function public.remove_runtime_mapping(uuid);

-- A public lookup nobody calls. Its contract is right (approved, latest effective_from not after
-- the moment asked, micros) and its home is not: the callers will be definer code in `app`, next
-- to `provider_rate_at`, so it returns there with its first caller.
drop function public.retail_rate_at(text, text, timestamptz);

-- Phone-number inventory functions built ahead of a softphone that does not exist. The tables
-- and `assign_phone_number` / `resolve_effective_outbound_identity` stay; the writers come back
-- with the feature that needs them, shaped by it.
drop function public.sync_phone_number(uuid, uuid, text, text, text);
drop function public.release_phone_number_assignment(uuid, uuid);
drop function public.set_user_phone_number_preference(uuid, uuid);

-- ---------------------------------------------------------------------------
-- Indexes that answer nothing the unique index beside them does not
-- ---------------------------------------------------------------------------
-- Each unique index has the same key columns; a btree is read backwards as easily as forwards,
-- so the descending copy serves no query the unique one cannot.
drop index public.platform_retail_rates_meter_currency_idx;
drop index public.platform_product_prices_current_idx;
drop index public.organization_plan_agreements_org_plan_idx;

-- ---------------------------------------------------------------------------
-- agent_run_documents: the identity is the attached document
-- ---------------------------------------------------------------------------
-- A document is attached to at most one run within an organization, which the unique constraint
-- already said. That is the row's identity, so it is the primary key; a surrogate id would add a
-- second way to name a row nothing refers to.
alter table public.agent_run_documents drop constraint agent_run_documents_document_once;
alter table public.agent_run_documents
  add constraint agent_run_documents_pkey primary key (organization_id, document_id);
