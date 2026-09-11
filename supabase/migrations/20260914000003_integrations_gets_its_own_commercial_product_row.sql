-- The Integrations module, added to GOLD's own product catalogue.
--
-- `platform_products` is additive by convention (D43) — a new module gets a new row in a new
-- migration rather than an edit to `20260910000001`, which may already be applied elsewhere
-- (D15: a migration that may have been applied is never modified).
insert into public.platform_products (key, kind, module_key, label) values
  ('module:integrations', 'module', 'integrations', 'Integrations');
