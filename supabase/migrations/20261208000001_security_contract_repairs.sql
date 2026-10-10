-- Three database contract repairs found by the schema-conformance suite.

-- 1. account_profiles carries personal identity; its policies already restrict it to the owning
--    account, and forcing RLS makes that hold for the table owner as well (I1). The SECURITY
--    DEFINER trigger that creates a profile runs as the owner, which bypasses RLS as it does for
--    every other forced table.
alter table public.account_profiles force row level security;

-- Session scope is read once per statement, not once per row: auth.jwt() is wrapped as its own
-- scalar subquery so it becomes an InitPlan (the shape the conformance suite requires).
drop policy account_profiles_read on public.account_profiles;
drop policy account_profiles_insert on public.account_profiles;
drop policy account_profiles_update on public.account_profiles;
create policy account_profiles_read on public.account_profiles for select to authenticated
  using (user_id = (select auth.uid()) and not coalesce((((select auth.jwt()))->>'is_anonymous')::boolean, false));
create policy account_profiles_insert on public.account_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((((select auth.jwt()))->>'is_anonymous')::boolean, false));
create policy account_profiles_update on public.account_profiles for update to authenticated
  using (user_id = (select auth.uid()) and not coalesce((((select auth.jwt()))->>'is_anonymous')::boolean, false))
  with check (user_id = (select auth.uid()) and not coalesce((((select auth.jwt()))->>'is_anonymous')::boolean, false));

-- 2. The same wrapping for the evaluation policies. Behaviour is unchanged.
drop policy ai_evaluations_read on public.ai_assistant_evaluations;
drop policy ai_evaluations_insert on public.ai_assistant_evaluations;
drop policy ai_evaluations_verdict on public.ai_assistant_evaluations;
create policy ai_evaluations_read on public.ai_assistant_evaluations for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and created_by = (select auth.uid()));
create policy ai_evaluations_insert on public.ai_assistant_evaluations for insert to authenticated
  with check (created_by = (select auth.uid()) and app.has_capability(organization_id, 'organization.manage') and
    exists (select 1 from public.ai_assistant_versions v where v.organization_id = ai_assistant_evaluations.organization_id and v.id = version_id and v.assistant_id = ai_assistant_evaluations.assistant_id));
create policy ai_evaluations_verdict on public.ai_assistant_evaluations for update to authenticated
  using (created_by = (select auth.uid()) and app.has_capability(organization_id, 'organization.manage'))
  with check (created_by = (select auth.uid()) and app.has_capability(organization_id, 'organization.manage'));

-- 3. One enabled website responder per site. A public site belongs to exactly one organization
--    (the deployment's composite foreign key to public_sites(organization_id, id)), so leading
--    the index with organization_id keeps the rule exactly as strict while satisfying I2.
drop index public.ai_one_website_responder;
create unique index ai_one_website_responder on public.ai_assistant_deployments(organization_id, public_site_id)
  where surface = 'website_chat' and enabled;
