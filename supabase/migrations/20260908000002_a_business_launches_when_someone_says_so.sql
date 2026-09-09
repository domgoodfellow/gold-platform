-- Setup and Live, and the one action that moves a business between them.
--
-- **Two states only.** Suspension, offboarding and paid entitlement are separate, later
-- questions (D41 remains undone) -- this column answers nothing about money and nothing about
-- whether a business is still allowed to operate. It answers one thing: whether Business Setup
-- should be the loudest thing in the shell.
--
-- **Readiness is not this column, and is not a column at all.** Whether a business currently
-- has everything a switched-on module needs is computed fresh, in TypeScript, by extending
-- `outstandingModuleSetup` -- the same function Settings already reads -- rather than a second
-- readiness calculation living here. A persisted `ready` boolean would be exactly the second
-- answer I4 and I5 already refuse one level up, and it would go stale the moment a module was
-- switched off again. So this migration adds a state, not a verdict.

alter table public.organizations
  add column operational_state text not null default 'setup'
    constraint organizations_operational_state_known
    check (operational_state in ('setup', 'live'));

comment on column public.organizations.operational_state is
  'Whether this business is still being configured or is running for real. Not billing, not entitlement (D41 remains undone), not suspension or offboarding -- those are separate, later states. Set once, forward only, by launch_organization().';

-- **Pre-existing rows predate this concept entirely.** A business that already carries jobs,
-- invoices and months of history is not "still being set up" -- treating it that way would be a
-- worse guess than assuming it is already operating, and would put a "Setting up" banner in
-- front of every demo business the moment this migration ran. Every row inserted after this
-- migration gets 'setup' from the column default instead, which is the state every real new
-- business should actually start in.
update public.organizations set operational_state = 'live';

-- ---------------------------------------------------------------------------
-- Launching
-- ---------------------------------------------------------------------------

-- **No column grant to `authenticated`, on purpose.** Every other setting a business owns
-- (name, timezone, currency, buffer, slug) is reachable through `update_organization`, an
-- invoker-rights function that leans on `organizations_update`'s policy and a column grant.
-- This one is different: launching is a one-way door, and whether it may happen at all depends
-- on readiness computed in the domain layer, not on anything a policy can see. So this is its
-- own SECURITY DEFINER function, on the `provision_organization` shape -- an explicit capability
-- check in the body, and no privilege on the column for anyone to route around it with.
--
-- **What this function does not decide.** It has no opinion on blockers or warnings -- that
-- computation stays in TypeScript (`computeReadiness`, reusing `outstandingModuleSetup`) and is
-- re-run immediately before this is called, in the same request, so a page rendered moments
-- earlier cannot launch a business that has since acquired a blocker. This function only
-- performs the transition once the caller has already decided it may happen: check the
-- capability, flip the state forward, record why.
create function public.launch_organization(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'launch_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Not a membership check and then a capability check -- `has_capability` already returns
  -- false for a caller who is not a member of this organization at all, so one call covers both
  -- and the refusal reads the same either way (I12).
  if not app.has_capability(p_id, 'organization.manage') then
    raise exception 'no such organization, or you may not launch it'
      using errcode = '42501';
  end if;

  update public.organizations
     set operational_state = 'live'
   where id = p_id
     and operational_state = 'setup'
  returning id into v_org;

  if v_org is null then
    raise exception 'this business is already live, or does not exist'
      using errcode = '23514';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_id, v_actor, 'organization', p_id, 'organization.launched', '{}'::jsonb);
end;
$fn$;

comment on function public.launch_organization(uuid) is
  'The one deliberate action that moves a business from Setup to Live. Refuses if it is not currently in Setup or the caller lacks organization.manage; refuses nothing about readiness, which is computed in TypeScript immediately beforehand and never duplicated here.';

revoke all on function public.launch_organization(uuid) from public;
grant execute on function public.launch_organization(uuid) to authenticated;
