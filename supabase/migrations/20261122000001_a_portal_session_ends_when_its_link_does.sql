-- A portal session is a durable credential that outlives the request that made it, and it ends
-- when the link that made it does.
--
-- **What this fixes.** The portal page signed the visitor in anonymously *while rendering*, and a
-- render cannot write a cookie, so the session lasted for that one render and every later action
-- ran with none. The web runtime now exchanges the link for a session in a route handler, where a
-- cookie can be kept. That fixes persistence; it creates the second question this migration
-- answers: a cookie that stays valid for as long as the browser keeps it must still stop working
-- when the business withdraws the link.
--
-- **The binding remembers the link that made it.** `external_actors.portal_invite_id` names the
-- invite a portal binding came from, and `portal_expires_at` bounds how long one exchange is good
-- for. `app.current_external_customer()` — which every portal policy and function already goes
-- through, and which is why nothing else here has to change — answers null once the invite is
-- revoked or the binding has expired. Revocation therefore needs no session table and no sweep:
-- the next request after it is simply no longer that customer.
--
-- A binding with no `portal_invite_id` is not a portal one (a booking visitor's own, or a
-- proposal reviewer's) and behaves exactly as before.

alter table public.customer_portal_invites
  add constraint customer_portal_invites_org_id_unique unique (organization_id, id);

alter table public.external_actors
  add column portal_invite_id  uuid,
  add column portal_expires_at timestamptz,
  add constraint external_actors_portal_invite_same_org
    foreign key (organization_id, portal_invite_id)
    references public.customer_portal_invites (organization_id, id) on delete cascade,
  add constraint external_actors_portal_binding_is_whole
    check ((portal_invite_id is null) = (portal_expires_at is null));

comment on column public.external_actors.portal_invite_id is
  'The portal link this binding was made from. While it is set, the binding is the customer only as long as that link is not revoked. Written only by claim_portal_invite; in no column grant.';
comment on column public.external_actors.portal_expires_at is
  'When this exchange of a portal link stops counting, whether or not the link is still live. Reopening the link makes a new one. Written only by claim_portal_invite; in no column grant.';

-- `grant insert (organization_id, user_id)` is column-wise (20260902000002), so neither new column
-- is writable by any signed-in role. The comment on each says so; this is what makes it true.

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
      ea.portal_invite_id is null
      or (
        ea.portal_expires_at > now()
        and exists (
          select 1
          from public.customer_portal_invites i
          where i.organization_id = ea.organization_id
            and i.id = ea.portal_invite_id
            and i.revoked_at is null
        )
      )
    );
$fn$;

comment on function app.current_external_customer() is
  'The customer an outsider has been recognised as, or null. A portal binding stops answering when its link is revoked or its exchange has expired; every portal policy reads this, so revocation needs no second mechanism.';

-- The one question a portal request asks first: who is this, and for how long. A definer function
-- because `external_actors` is not selectable by the outsider it describes (D22), and one with no
-- argument because the answer is the caller's own and nothing they could pass would change it.
create function public.portal_context()
returns table (organization_id uuid, customer_id uuid, portal_invite_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select ea.organization_id, ea.customer_id, ea.portal_invite_id, ea.portal_expires_at
  from public.external_actors ea
  where ea.user_id = (select auth.uid())
    and ea.portal_invite_id is not null
    and app.current_external_customer() is not null;
$fn$;

revoke all on function public.portal_context() from public;
grant execute on function public.portal_context() to authenticated;

comment on function public.portal_context() is
  'The caller''s own live portal binding, or no row. No row means: never a portal customer, link revoked, or exchange expired — deliberately not distinguishable.';

-- The exchange itself. Two changes from the version in 20260829000010, and nothing else:
--
-- 1. **An anonymous caller only.** The portal is a customer's identity, and a signed-in member of
--    a business is a different one (an operator is not a customer). Binding a real account as an
--    outsider would give one user id both a membership and a portal scope.
-- 2. **The binding records its link and its expiry.** Reopening the link rewrites both, so a
--    customer who comes back is good for another period without the business doing anything.
--
-- The lifetime is a platform security parameter, not a business's content: the business's own
-- control over it is the one it has always had, revoking the link.
create or replace function public.claim_portal_invite(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_invite public.customer_portal_invites;
begin
  if v_actor is null then
    raise exception 'claim_portal_invite requires an authenticated caller'
      using errcode = '42501';
  end if;

  if not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'that link is not valid'
      using errcode = '42501';
  end if;

  select * into v_invite
  from public.customer_portal_invites
  where token = p_token
    and revoked_at is null;

  if v_invite.id is null then
    raise exception 'that link is not valid'
      using errcode = '42501';
  end if;

  if not app.module_enabled(v_invite.organization_id, 'portal') then
    raise exception 'that link is not valid'
      using errcode = '42501';
  end if;

  insert into public.external_actors
    (organization_id, user_id, customer_id, portal_invite_id, portal_expires_at)
  values
    (v_invite.organization_id, v_actor, v_invite.customer_id, v_invite.id, now() + interval '30 days')
  on conflict (user_id) do update
    set customer_id       = excluded.customer_id,
        portal_invite_id  = excluded.portal_invite_id,
        portal_expires_at = excluded.portal_expires_at
  where public.external_actors.organization_id = v_invite.organization_id;

  if not found then
    raise exception 'this browser is already booking with another business'
      using errcode = '42501';
  end if;

  return v_invite.organization_id;
end;
$fn$;
