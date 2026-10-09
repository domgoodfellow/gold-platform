-- Claim a reviewed document before its first canonical write. No tenant configuration
-- is copied into this state; an interrupted claim must be reviewed, never replayed.
alter table public.configuration_proposals drop constraint configuration_proposals_outcome_check;
alter table public.configuration_proposals add constraint configuration_proposals_outcome_check
  check (outcome in ('draft', 'applying', 'applied', 'failed', 'discarded'));

drop policy configuration_proposals_update on public.configuration_proposals;
create policy configuration_proposals_update on public.configuration_proposals
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and outcome in ('draft', 'applying')
    and app.has_capability(organization_id, 'configuration.propose')
  )
  with check (organization_id in (select app.current_tenant_ids()));

create function app.guard_claimed_configuration_proposal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.outcome = 'applying' and (
    new.outcome not in ('applied', 'failed')
    or new.shape is distinct from old.shape
    or new.description is distinct from old.description
    or new.gaps is distinct from old.gaps
  ) then
    raise exception using errcode = '55000', message = 'A setup being applied cannot be edited or replayed.';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_claimed_configuration_proposal() from public;
create trigger guard_claimed_configuration_proposal
  before update on public.configuration_proposals
  for each row execute function app.guard_claimed_configuration_proposal();

-- Recovery: leave interrupted applying rows visible in proposal history and inspect
-- canonical configuration before creating a new remainder draft. No automatic replay.
-- Historical applied/failed/discarded rows and existing column grants remain unchanged.
