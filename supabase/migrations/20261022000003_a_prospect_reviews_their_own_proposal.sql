-- Slice 9 of the commercial-funnel plan: a prospect opens a secure link and reviews, then
-- accepts or declines, the commercial proposal built for them.
--
-- **This pays for nothing new on the external axis.** D22 already answered "how does an outsider
-- reach one specific record": `external_actors` binds a browser to at most one organization and,
-- since the portal, to one customer within it (`app.current_external_tenant()`,
-- `app.current_external_customer()`). A proposal invite is a third *kind of token* over the same
-- axis — `customer_proposal_invites` mirrors `customer_portal_invites` exactly, and
-- `claim_proposal_invite` writes the same `external_actors.customer_id` column
-- `claim_portal_invite` already does. One browser can hold a proposal invite and, later, a
-- portal invite for the same customer without conflict, because both recognize the same fact.
--
-- What a recognized customer may read is everything already visible to any signed-in caller
-- (the canonical catalogue, `platform_catalog_*`, is `using (true)` for `authenticated` already)
-- plus their own discovery snapshot and their own non-draft proposals — never a draft, which is
-- a salesperson's unfinished work, not something they have been sent.
--
-- Accepting or declining is a third and fourth narrow door, not a table grant (D40's reasoning
-- restated: something this consequential is a checked, audited function or it is a widened grant
-- someone regrets). Only `status` moves through an ordinary grant (`markCommercialProposalSent`,
-- Slice 8) — a proposal's own team marking it sent is low-stakes; a customer's acceptance is not.

-- ---------------------------------------------------------------------------
-- The invitation
-- ---------------------------------------------------------------------------

create table public.customer_proposal_invites (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  customer_id     uuid        not null,
  token           text        not null check (length(token) >= 32),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  revoked_at      timestamptz,

  constraint customer_proposal_invites_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade
);

comment on table public.customer_proposal_invites is
  'A link GildOps sends a prospect to review their own commercial proposal. Anyone holding it is that customer -- the same shared-document model customer_portal_invites already uses -- and GildOps revokes it.';

-- Presented by the outside world before it is known which tenant it belongs to -- the same
-- reasoning `customer_portal_invites_token_unique` and `external_actors_one_tenant_per_user`
-- already carry, and the third named exception `schema-conformance.test.ts` expects.
create unique index customer_proposal_invites_token_unique
  on public.customer_proposal_invites (token);

create index customer_proposal_invites_org_customer_idx
  on public.customer_proposal_invites (organization_id, customer_id);

alter table public.customer_proposal_invites enable row level security;
alter table public.customer_proposal_invites force row level security;

create policy customer_proposal_invites_select on public.customer_proposal_invites
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- price.manage, not customer.create: sending someone a commercial proposal is a pricing act.
create policy customer_proposal_invites_insert on public.customer_proposal_invites
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'price.manage')
  );

create policy customer_proposal_invites_update on public.customer_proposal_invites
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'price.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'price.manage'));

grant select, insert on public.customer_proposal_invites to authenticated;
grant update (revoked_at) on public.customer_proposal_invites to authenticated;

create function public.create_proposal_invite(p_customer_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_customer public.customers;
  v_token    text := replace(gen_random_uuid()::text, '-', '')
                  || replace(gen_random_uuid()::text, '-', '');
begin
  if v_actor is null then
    raise exception 'create_proposal_invite requires an authenticated caller'
      using errcode = '42501';
  end if;

  select * into v_customer from public.customers where id = p_customer_id;

  if v_customer.id is null then
    raise exception 'no such customer, or you may not invite them'
      using errcode = '42501';
  end if;

  insert into public.customer_proposal_invites (organization_id, customer_id, token, created_by)
  values (v_customer.organization_id, p_customer_id, v_token, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_customer.organization_id, v_actor, 'customer', p_customer_id, 'customer.proposal_invited',
     jsonb_build_object('customer_id', p_customer_id));

  return v_token;
end;
$fn$;

revoke all on function public.create_proposal_invite(uuid) from public;
grant execute on function public.create_proposal_invite(uuid) to authenticated;

create function public.claim_proposal_invite(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_invite public.customer_proposal_invites;
begin
  if v_actor is null then
    raise exception 'claim_proposal_invite requires an authenticated caller'
      using errcode = '42501';
  end if;

  select * into v_invite
  from public.customer_proposal_invites
  where token = p_token
    and revoked_at is null;

  if v_invite.id is null then
    raise exception 'that link is not valid'
      using errcode = '42501';
  end if;

  insert into public.external_actors (organization_id, user_id, customer_id)
  values (v_invite.organization_id, v_actor, v_invite.customer_id)
  on conflict (user_id) do update
    set customer_id = excluded.customer_id
  where public.external_actors.organization_id = v_invite.organization_id;

  if not found then
    raise exception 'this browser is already recognized by another business'
      using errcode = '42501';
  end if;

  return v_invite.organization_id;
end;
$fn$;

revoke all on function public.claim_proposal_invite(text) from public;
grant execute on function public.claim_proposal_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- What acceptance and decline record (I8: a snapshot, not a live join)
-- ---------------------------------------------------------------------------

alter table public.customer_commercial_proposals
  add column plan_label              text,
  add column accepted_by             uuid references auth.users (id),
  add column accepted_at             timestamptz,
  add column declined_by             uuid references auth.users (id),
  add column declined_at             timestamptz,
  -- What `recommendConfiguration` showed at the moment of acceptance -- a receipt of what was
  -- seen, computed by the caller's own session (which can already read everything it draws from)
  -- and stored as told, the same trust `configuration_proposals.result` already carries for an
  -- outcome nothing here could re-derive after the fact.
  add column accepted_configuration  jsonb;

update public.customer_commercial_proposals p
   set plan_label = pl.label
  from public.platform_plans pl
 where pl.id = p.plan_id;

alter table public.customer_commercial_proposals
  alter column plan_label set not null,
  add constraint customer_commercial_proposals_accepted_is_complete
    check ((accepted_by is null) = (accepted_at is null)),
  add constraint customer_commercial_proposals_declined_is_complete
    check ((declined_by is null) = (declined_at is null)),
  add constraint customer_commercial_proposals_status_matches_response
    check (
      (status = 'accepted') = (accepted_at is not null)
      and (status = 'declined') = (declined_at is not null)
    );

-- I18: caught by `schema-conformance.test.ts` -- the plain `references` clause Slice 8 wrote for
-- `supersedes_id` is a reference between two tenant-owned tables with no `organization_id` in the
-- key, exactly what that invariant refuses. Composite, the same as every other self-reference in
-- this schema.
alter table public.customer_commercial_proposals
  drop constraint customer_commercial_proposals_supersedes_id_fkey,
  add constraint customer_commercial_proposals_supersedes_same_org
    foreign key (organization_id, supersedes_id)
    references public.customer_commercial_proposals (organization_id, id);

alter table public.customer_commercial_proposal_addons
  add column label text;

update public.customer_commercial_proposal_addons a
   set label = pl.label
  from public.platform_plans pl
 where pl.id = a.addon_plan_id;

alter table public.customer_commercial_proposal_addons
  alter column label set not null;

-- ---------------------------------------------------------------------------
-- What a recognized customer may read
-- ---------------------------------------------------------------------------

-- Never a draft: a salesperson's unfinished work is not something a prospect has been sent.
-- Both scope functions are wrapped in `(select ...)`, the same discipline every other policy on
-- this axis holds to (`20260902000010`) -- otherwise Postgres would re-evaluate them once per row
-- rather than once per statement.
create policy customer_commercial_proposals_select_external on public.customer_commercial_proposals
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and customer_id = (select app.current_external_customer())
    and status <> 'draft'
  );

create policy customer_commercial_proposal_addons_select_external on public.customer_commercial_proposal_addons
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and proposal_id in (
      select p.id from public.customer_commercial_proposals p
      where p.organization_id = public.customer_commercial_proposal_addons.organization_id
        and p.customer_id = (select app.current_external_customer())
        and p.status <> 'draft'
    )
  );

-- "What we understood" -- the discovery snapshot behind the proposal, in the same words a
-- salesperson recorded them.
create policy customer_discovery_snapshots_select_external on public.customer_discovery_snapshots
  for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and customer_id = (select app.current_external_customer())
  );

-- ---------------------------------------------------------------------------
-- Accepting or declining (D40: a narrow door, never a column grant)
-- ---------------------------------------------------------------------------

create function public.accept_commercial_proposal(
  p_proposal_id             uuid,
  p_accepted_configuration  jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_customer uuid := app.current_external_customer();
  v_org      uuid := app.current_external_tenant();
  v_proposal public.customer_commercial_proposals;
begin
  if v_actor is null or v_customer is null or v_org is null then
    raise exception 'accept_commercial_proposal requires a recognized customer'
      using errcode = '42501';
  end if;

  select * into v_proposal
  from public.customer_commercial_proposals
  where id = p_proposal_id and organization_id = v_org and customer_id = v_customer;

  if v_proposal.id is null then
    raise exception 'no such proposal, or you may not act on it'
      using errcode = '42501';
  end if;

  if v_proposal.status <> 'sent' then
    raise exception 'this proposal is not open for a response'
      using errcode = '42501';
  end if;

  update public.customer_commercial_proposals
     set status = 'accepted',
         accepted_by = v_actor,
         accepted_at = now(),
         accepted_configuration = p_accepted_configuration
   where id = p_proposal_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'customer', v_customer, 'commercial_proposal.accepted',
     jsonb_build_object('proposal_id', p_proposal_id, 'version', v_proposal.version));
end;
$fn$;

revoke all on function public.accept_commercial_proposal(uuid, jsonb) from public;
grant execute on function public.accept_commercial_proposal(uuid, jsonb) to authenticated;

create function public.decline_commercial_proposal(p_proposal_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_customer uuid := app.current_external_customer();
  v_org      uuid := app.current_external_tenant();
  v_proposal public.customer_commercial_proposals;
begin
  if v_actor is null or v_customer is null or v_org is null then
    raise exception 'decline_commercial_proposal requires a recognized customer'
      using errcode = '42501';
  end if;

  select * into v_proposal
  from public.customer_commercial_proposals
  where id = p_proposal_id and organization_id = v_org and customer_id = v_customer;

  if v_proposal.id is null then
    raise exception 'no such proposal, or you may not act on it'
      using errcode = '42501';
  end if;

  if v_proposal.status <> 'sent' then
    raise exception 'this proposal is not open for a response'
      using errcode = '42501';
  end if;

  update public.customer_commercial_proposals
     set status = 'declined',
         declined_by = v_actor,
         declined_at = now()
   where id = p_proposal_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'customer', v_customer, 'commercial_proposal.declined',
     jsonb_build_object('proposal_id', p_proposal_id, 'version', v_proposal.version));
end;
$fn$;

revoke all on function public.decline_commercial_proposal(uuid) from public;
grant execute on function public.decline_commercial_proposal(uuid) to authenticated;
