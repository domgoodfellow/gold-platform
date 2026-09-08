-- An anonymous session may not create an organization.
--
-- **This is the booking slice's bill arriving late.** 20260829000003 enabled anonymous
-- sign-in so that an outsider reaching `/book/{slug}` has a real `auth.uid()` -- which is what
-- kept I11 and D17 intact and is still the right answer. What it also did, silently, is
-- enlarge who the word `authenticated` refers to: a Supabase anonymous user carries
-- `role: authenticated` in its JWT exactly as a registered one does. Every grant already
-- written against that role widened with it, and nothing revisited them.
--
-- For all but one function that turned out to be harmless. Everything else granted to
-- `authenticated` either takes an organization id and dies on `app.has_capability`, or reads
-- through a policy keyed to `app.current_tenant_ids()` -- which is empty for somebody who is a
-- member of nothing, so the widening bought an anonymous caller precisely nothing.
--
-- `create_organization` is the exception, because it is the only function in this schema that
-- **bootstraps from nothing**: it takes no organization id, consults no capability, and its
-- entire gate is `auth.uid() is not null`. An anonymous session satisfies that. So the
-- sequence was: call the anonymous sign-in endpoint, receive a session, found a tenant --
-- with no email, no password and no confirmation anywhere in it.
--
-- **What it was not is a leak.** RLS held throughout: such a caller founds their *own* empty
-- organization and can no more read an existing tenant than before. What it produced is rows
-- this platform did not agree to hold, which is D29's objection to open signup arriving
-- through a door D29 was not looking at -- that record closes `/sign-up`, and closing
-- `/sign-up` would not have closed this.
--
-- **The two fixes are separate and this is only the first.** Whether a registered stranger may
-- found a tenant is a product decision, it belongs to D29, and it is one line in
-- `PUBLIC_PATHS`. Whether an *anonymous* one may is not a product decision at all: that
-- session exists to book an appointment, and D22 scopes it to exactly one organization for the
-- life of the binding. A caller whose whole purpose is to be bound to one tenant has no
-- business creating another.
--
-- The check reads `auth.users` rather than the JWT's `is_anonymous` claim. The table is
-- authoritative and the claim is a copy: Supabase can convert an anonymous user to a permanent
-- one, at which point the column flips and any token minted before it does not. Reading the
-- column means that conversion is honoured the moment it happens, and means this guard does
-- not depend on the shape of a vendor's claims.

create or replace function public.create_organization(
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
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Anonymous is a real session and a real `auth.uid()` -- that is the whole of D22's answer
  -- to question 2 -- and it is still not a person who may found a business. Coalesced because
  -- a null here must read as "not established anonymous", never as "not anonymous".
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_actor), true) then
    raise exception 'an anonymous session may not create an organization'
      using errcode = '42501';
  end if;

  -- Timezone coalesces and currency does not, and the asymmetry is the point. UTC is the
  -- absence of an assumption about a business; there is no neutral currency, so a platform
  -- default would be the platform deciding what this business trades in.
  if p_currency is null then
    raise exception 'an organization must say what currency it trades in'
      using errcode = '23514';
  end if;

  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  -- The operational core, and nothing that publishes anything.
  perform app.enable_default_modules(v_org, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency
     ));

  return v_org;
end;
$fn$;

comment on function public.create_organization(text, text, text[], text, text, text) is
  'Founds an organization and its first membership. The only function here that bootstraps from nothing, which is why it is the only one that must ask whether its caller is anonymous.';
