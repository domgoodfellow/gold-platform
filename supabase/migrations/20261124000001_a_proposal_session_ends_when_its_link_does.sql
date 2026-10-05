-- A proposal session is a durable credential that outlives the request that made it, and it ends
-- when the link that made it does — the same repair `20261122000001` made for the portal, applied
-- to the one other customer link that still signed in while a page rendered.
--
-- **What this fixes.** `/proposal/{token}` signed the visitor in anonymously *while rendering*. A
-- render cannot write a cookie, so that session lasted for the one render and Accept/Decline ran
-- later with none. The web runtime now exchanges the link in a route handler, keeps the session
-- in a cookie of the proposal's own, and redirects to an address with no secret in it.
--
-- **Contract, decided here rather than left to accident.**
--   * The link is reusable; reopening it renews the exchange for another 30 days.
--   * Revoking the link ends every session made from it, on that session's next request.
--   * Acceptance and decline do not end access: the link keeps showing the outcome. They are
--     refused, once, by the proposal's own status — not by the link.
--   * A customer decides on the exact version they were shown. A version with a non-draft
--     successor is refused, so reissuing never lets "Accept" land on terms nobody saw.
--
-- A proposal binding is a second *kind* of binding on the one `external_actors` row. It is never
-- the same browser session as a portal one (separate cookies, separate anonymous users), so a
-- row carries at most one link.

alter table public.customer_proposal_invites
  add constraint customer_proposal_invites_org_id_unique unique (organization_id, id);

alter table public.external_actors
  add column proposal_invite_id  uuid,
  add column proposal_expires_at timestamptz,
  add constraint external_actors_proposal_invite_same_org
    foreign key (organization_id, proposal_invite_id)
    references public.customer_proposal_invites (organization_id, id) on delete cascade,
  add constraint external_actors_proposal_binding_is_whole
    check ((proposal_invite_id is null) = (proposal_expires_at is null)),
  add constraint external_actors_one_kind_of_link
    check (proposal_invite_id is null or portal_invite_id is null);

comment on column public.external_actors.proposal_invite_id is
  'The proposal link this binding was made from. While set, the binding is the customer only as long as that link is not revoked. Written only by claim_proposal_invite; in no column grant.';
comment on column public.external_actors.proposal_expires_at is
  'When this exchange of a proposal link stops counting, whether or not the link is still live. Reopening the link makes a new one. Written only by claim_proposal_invite; in no column grant.';

create or replace function app.current_external_customer()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select ea.customer_id
  from public.external_actors ea
  where ea.user_id = (select auth.uid())
    and (
      (ea.portal_invite_id is null and ea.proposal_invite_id is null)
      or (
        ea.portal_invite_id is not null
        and ea.portal_expires_at > now()
        and exists (
          select 1
          from public.customer_portal_invites i
          where i.organization_id = ea.organization_id
            and i.id = ea.portal_invite_id
            and i.revoked_at is null
        )
      )
      or (
        ea.proposal_invite_id is not null
        and ea.proposal_expires_at > now()
        and exists (
          select 1
          from public.customer_proposal_invites i
          where i.organization_id = ea.organization_id
            and i.id = ea.proposal_invite_id
            and i.revoked_at is null
        )
      )
    );
$fn$;

comment on function app.current_external_customer() is
  'The customer an outsider has been recognised as, or null. A portal or proposal binding stops answering when its link is revoked or its exchange has expired; every external policy reads this, so revocation needs no second mechanism.';

create function public.proposal_context()
returns table (organization_id uuid, customer_id uuid, proposal_invite_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select ea.organization_id, ea.customer_id, ea.proposal_invite_id, ea.proposal_expires_at
  from public.external_actors ea
  where ea.user_id = (select auth.uid())
    and ea.proposal_invite_id is not null
    and app.current_external_customer() is not null;
$fn$;

revoke all on function public.proposal_context() from public;
grant execute on function public.proposal_context() to authenticated;

comment on function public.proposal_context() is
  'The caller''s own live proposal binding, or no row. No row means: never a proposal recipient, link revoked, or exchange expired — deliberately not distinguishable.';

create or replace function public.claim_proposal_invite(p_token text)
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

  -- A recipient is not an organization member: binding a real account as an outsider would give
  -- one user id both a membership and a customer scope.
  if not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'that link is not valid'
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

  insert into public.external_actors
    (organization_id, user_id, customer_id, proposal_invite_id, proposal_expires_at)
  values
    (v_invite.organization_id, v_actor, v_invite.customer_id, v_invite.id, now() + interval '30 days')
  on conflict (user_id) do update
    set customer_id         = excluded.customer_id,
        proposal_invite_id  = excluded.proposal_invite_id,
        proposal_expires_at = excluded.proposal_expires_at,
        portal_invite_id    = null,
        portal_expires_at   = null
  where public.external_actors.organization_id = v_invite.organization_id;

  if not found then
    raise exception 'this browser is already recognized by another business'
      using errcode = '42501';
  end if;

  return v_invite.organization_id;
end;
$fn$;

-- One transition, decided under a row lock: two tabs, a double click or an accept racing a
-- decline all serialise here, and the loser reads the winner's status and is refused.
create or replace function public.accept_commercial_proposal(p_proposal_id uuid)
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
  where id = p_proposal_id and organization_id = v_org and customer_id = v_customer
  for update;

  if v_proposal.id is null then
    raise exception 'no such proposal, or you may not act on it'
      using errcode = '42501';
  end if;

  if v_proposal.status <> 'sent' then
    raise exception 'this proposal is not open for a response'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.customer_commercial_proposals n
    where n.organization_id = v_org and n.supersedes_id = v_proposal.id and n.status <> 'draft'
  ) then
    raise exception 'this proposal has been replaced by a newer version'
      using errcode = '42501';
  end if;

  update public.customer_commercial_proposals
     set status = 'accepted',
         accepted_by = v_actor,
         accepted_at = now(),
         accepted_configuration = v_proposal.proposed_configuration
   where id = p_proposal_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'customer', v_customer, 'commercial_proposal.accepted',
     jsonb_build_object('proposal_id', p_proposal_id, 'version', v_proposal.version));
end;
$fn$;

create or replace function public.decline_commercial_proposal(p_proposal_id uuid)
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
  where id = p_proposal_id and organization_id = v_org and customer_id = v_customer
  for update;

  if v_proposal.id is null then
    raise exception 'no such proposal, or you may not act on it'
      using errcode = '42501';
  end if;

  if v_proposal.status <> 'sent' then
    raise exception 'this proposal is not open for a response'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.customer_commercial_proposals n
    where n.organization_id = v_org and n.supersedes_id = v_proposal.id and n.status <> 'draft'
  ) then
    raise exception 'this proposal has been replaced by a newer version'
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
