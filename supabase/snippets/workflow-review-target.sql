-- Point the homepage's workflow-review form at GOLD's own organization.
--
-- **Run by hand, with database access, once per deployment** — the same reason
-- `add-platform-staff.sql` is a snippet and not a screen. D42 is explicit about why this can
-- never be a migration: "a migration cannot name an organization id that only exists in one
-- deployment." A fresh local database, and any deployment before GOLD's own organization has
-- been created in it, has nothing to point at, and `request_workflow_review` says so honestly
-- (D31) rather than filing a submission nobody would ever see.
--
-- **Edit the slug on the next line and run the block.** Raises rather than silently affecting
-- zero rows if the slug does not match an organization, for the same reason
-- `add-platform-staff.sql` raises on an unmatched email.
do $$
declare
  v_org_id uuid;
  v_slug   text := 'gold';
begin
  select o.id into v_org_id from public.organizations o where o.slug = v_slug;

  if v_org_id is null then
    raise exception 'No organization with the slug %. Create GOLD''s own organization first.', v_slug;
  end if;

  update public.platform_settings set workflow_review_organization_id = v_org_id where singleton;

  -- The same ordinary GOLD organization owns the root website. This is idempotent: an existing
  -- page and all revision history are retained; only an absent first published revision is
  -- bootstrapped from the shipped homepage copy.
  perform app.bootstrap_gold_public_site(v_org_id);

  raise notice 'Workflow-review submissions will land on organization % (%).', v_slug, v_org_id;
end
$$;

-- What it is set to today.
select workflow_review_organization_id, gold_public_organization_id, gold_public_site_id
from public.platform_settings;
