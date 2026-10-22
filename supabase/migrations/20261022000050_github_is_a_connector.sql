-- GitHub, as a connector a business can authorize.
--
-- What is authorized is a GitHub **App installation** on the repositories the business chooses --
-- not an OAuth grant over a whole account -- because that is the narrowing and the revocation a
-- business actually wants. The adapter is `apps/api/app/connectors/github.py`; this row is only
-- the catalogue's word for it, and `status` is the catalogue's *product maturity* and nothing
-- else. Whether a deployment holds the App's registration is the API's own answer
-- (`readiness`), so this row never makes a Connect button appear on a deployment that has none.
--
-- `beta`, not `live`: the adapter reads repository metadata and nothing more. It writes no commit,
-- branch or pull request; that arrives with the Studio deployment work and asks the person again.
--
-- A repository a business has authorized is an `integration_resources` row reached through its
-- connection, so it is written only by the machine role that holds the credential
-- (20261103000001): a tenant cannot assert "GildOps has access to this repository".

insert into public.platform_connectors
  (key, name, description, category, suite, status, auth_method, connection_method, is_public, display_order, capabilities)
values
  ('github', 'GitHub',
   'Choose the repositories GildOps may read, for Studio and deployments.',
   'Source control', null, 'beta', 'oauth2', 'native', true, 25, array['app_connections'])
on conflict (key) do nothing;
