-- organization_launch_blockers answered for any organization id a signed-in caller supplied,
-- so a member of one business (or a booking visitor, who is also `authenticated`) could ask
-- whether another had a module switched on and no payment account behind it.
--
-- The answer is split the way `credit_balance` / `credit_balance_unchecked` already are. The
-- trigger that refuses SETUP -> LIVE calls the unchecked core, because it runs inside the
-- transition and already knows the row; the door a caller reaches proves they belong there first.
-- Belonging is the two facts `organizations_select` and `organizations_platform_select` already
-- use: a membership of that organization, or a live `platform_staff` row.

create function app.organization_launch_blockers_unchecked(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_slug     text;
  v_booking  boolean;
  v_cards    boolean;
  v_blockers text[] := array[]::text[];
begin
  select o.slug into v_slug from public.organizations o where o.id = p_id;

  select exists (
    select 1 from public.organization_modules m
    where m.organization_id = p_id and m.module_key = 'booking'
  ) into v_booking;

  -- A switched-on public page with no address, or nothing published to it, is unreachable --
  -- not merely unfinished (`outstandingModuleSetup`'s own two notes for this module).
  if v_booking and (
    v_slug is null
    or not exists (
      select 1 from public.work_item_types t
      where t.organization_id = p_id and t.booking_status_id is not null
    )
  ) then
    v_blockers := array_append(v_blockers, 'booking');
  end if;

  select exists (
    select 1 from public.organization_modules m
    where m.organization_id = p_id and m.module_key = 'card_payments'
  ) into v_cards;

  -- No connected account is the one fact worth checking here, and it is true whether the cause
  -- is "this deployment has no processor" or "nobody has connected one yet" -- either way,
  -- nothing behind the switch actually works.
  if v_cards and not exists (
    select 1 from public.payment_accounts a where a.organization_id = p_id
  ) then
    v_blockers := array_append(v_blockers, 'card_payments');
  end if;

  return v_blockers;
end;
$fn$;

revoke all on function app.organization_launch_blockers_unchecked(uuid) from public;

comment on function app.organization_launch_blockers_unchecked(uuid) is
  'Which module keys currently block a launch, for any organization. No authorization: reachable only from the launch trigger and from public.organization_launch_blockers, which proves the caller first.';

create or replace function public.organization_launch_blockers(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;

  -- One refusal for "not yours" and "does not exist", so the answer is no oracle for either.
  if not (p_id in (select app.current_tenant_ids()) or app.is_platform_staff()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  return app.organization_launch_blockers_unchecked(p_id);
end;
$fn$;

comment on function public.organization_launch_blockers(uuid) is
  'Which module keys currently block a launch. A member of the organization or platform staff may ask; anybody else is refused, so it cannot be used to probe another business.';

-- The transition trigger names the unchecked core and is `security definer`, so it holds whoever
-- performs the update and does not depend on that role being able to reach `app`.
create or replace function app.check_launch_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_blockers text[];
begin
  v_blockers := app.organization_launch_blockers_unchecked(new.id);

  if array_length(v_blockers, 1) > 0 then
    raise exception 'this business still has something switched on and not working: %',
      array_to_string(v_blockers, ', ')
      using errcode = '55000';
  end if;

  return new;
end;
$fn$;

comment on trigger organizations_check_launch_readiness on public.organizations is
  'I13''s shape, one table over: refuses SETUP -> LIVE while app.organization_launch_blockers_unchecked(id) is non-empty, inside the same statement that would otherwise commit it.';
