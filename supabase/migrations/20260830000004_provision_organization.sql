-- GOLD provisions a business: the operator door onto the one creation path (D29).
--
-- **This is the first thing platform staff may write, which is exactly D28's trigger to
-- revisit.** That record granted the role `select` and nothing else, and said in as many words
-- that the first staff *write* would be a new decision. This is it, and the decision is a
-- narrow one: not a write grant on `organizations` and `memberships` -- which would let staff
-- rename any business and add themselves to any of it -- but one `SECURITY DEFINER` function
-- doing one named thing, on the `create_booking` precedent (D22). The role's table grants are
-- untouched: it still holds no `insert`, `update` or `delete` on anything.
--
-- **Why that keeps I21 true rather than bending it.** The invariant is that a staff path writes
-- nothing belonging to a tenant, and every row this function writes belongs to a tenant that
-- did not exist when the call began. Staff may bring a tenant into existence; staff may not
-- reach into one that already exists, and that line is where the invariant now sits. Nothing
-- here takes an organization id, so there is no existing business this function could name.
--
-- **The staff member does not become a member.** The founding membership is the owner's, and
-- `created_by` on all three rows is the owner too -- the tenant's own rows carry no GOLD user
-- id anywhere in them, which is the whole of D28's objection to putting staff in `memberships`.
-- What does carry one is the event, because "GOLD created this business on this date" is a true
-- fact about the tenant's history and hiding it would make the audit trail a worse record than
-- the thing it describes.
--
-- **The owner must already have an account**, and that is not a gap this function should close.
-- It is the same precondition `addMember` states out loud -- *"Nobody with that address has an
-- account yet"* -- for the same reason: a membership references `auth.users`, and creating a
-- user needs the admin API, which `apps/web` may not hold and must not. See D29 in
-- `constraints.md` for what that means for closing `/sign-up`, which is a separate half.

create function public.provision_organization(
  p_owner_email  text,
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff       uuid := (select auth.uid());
  v_staff_name  text;
  v_owner       uuid;
  v_owner_email text := lower(btrim(p_owner_email));
  v_org         uuid;
  v_role        uuid;
begin
  -- **The scope check is the first act**, as it is in `create_booking`. A `SECURITY DEFINER`
  -- function runs as its owner, so everything after this line is unpoliced by construction and
  -- the gate has to be here rather than anywhere downstream.
  if v_staff is null then
    raise exception 'provision_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  select s.name into v_staff_name
    from public.platform_staff s
   where s.user_id = v_staff;

  -- Not "is this caller allowed to provision" -- there is no capability to ask about on this
  -- axis and no role inside a tenant to hang one on (D28). The question is only whether the
  -- caller is one of us.
  if v_staff_name is null then
    raise exception 'only platform staff may provision a business'
      using errcode = '42501';
  end if;

  select u.id into v_owner
    from auth.users u
   where lower(u.email) = v_owner_email;

  if v_owner is null then
    raise exception 'Nobody with the address % has an account yet. They have to sign up before a business can be handed to them.', v_owner_email
      using errcode = '23503';
  end if;

  -- The same refusal `create_organization` makes, for the same reason: an anonymous session
  -- exists to book an appointment and is bound to one tenant for the life of its binding (D22).
  -- Handing a business to one would be worse here than there, because here somebody chose to.
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_owner), true) then
    raise exception 'that account cannot own a business'
      using errcode = '42501';
  end if;

  if p_currency is null then
    raise exception 'an organization must say what currency it trades in'
      using errcode = '23514';
  end if;

  -- From here down this is `create_organization`'s body with one substitution: the owner in
  -- place of the caller. **That duplication is deliberate and is the smaller of two evils.**
  -- Folding both into one function would mean a single entry point that decides, from its
  -- arguments, whether it is being called by a founder or by staff -- and a function that
  -- branches on who is calling it is where an authorization mistake goes to hide. Two
  -- functions, two gates, one shape.
  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_owner)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_owner)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_owner, v_role, p_display_name, v_owner);

  perform app.enable_default_modules(v_org, v_owner);

  -- **`organization.created`, not `organization.provisioned`.** What happened is the same
  -- event through either door, and the payload records which one -- which is D29's whole
  -- correction expressed in a row: provisioned and self-served are not two kinds of tenant.
  -- A timeline reader that filters on the action keeps working, and one that wants to know how
  -- a business arrived reads the payload.
  --
  -- `actor_id` is the staff member because they are who acted. The tenant cannot resolve that
  -- id to anything -- `platform_staff` is invisible to them and so is `auth.users` -- so the
  -- readable half is snapshotted into the payload as a name (I8), the way every other payload
  -- in this schema carries the words rather than a join.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_staff, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency,
       'provisioned', true,
       'provisioned_by', v_staff_name,
       'owner_email', v_owner_email
     ));

  return v_org;
end;
$fn$;

comment on function public.provision_organization(text, text, text, text[], text, text, text) is
  'The operator door (D29): GOLD creates a business and hands it to an owner who already has an account. Staff do not become members of it. The first staff write, and the narrowest shape of one -- the platform_staff role still holds no table write grant.';

-- Executable by the staff role and by nobody else. `authenticated` is deliberately absent: an
-- operator founding their own business calls `create_organization`, which is the other door.
revoke all on function public.provision_organization(text, text, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.provision_organization(text, text, text, text[], text, text, text) to platform_staff;
