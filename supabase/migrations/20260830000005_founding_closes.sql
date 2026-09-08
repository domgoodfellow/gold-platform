-- The unattended door closes: an account is not a tenant.
--
-- D29 says a door may be open where somebody is on the far side of it doing the configuring,
-- and stays shut where nobody is. `provision_organization` opened the door where that somebody
-- is a person at GOLD (20260830000004). This shuts the one where nobody is there at all: a
-- stranger registers and founds a business, unaided, with no implementer, no proposal and no
-- review anywhere in it.
--
-- **What closes is founding, and `/sign-up` deliberately stays open.** D29's consequence line
-- said M5 "closes `/sign-up`", and building the operator door showed that to be the wrong
-- target rather than merely a hard one: `provision_organization` names an owner who must
-- already have an `auth.users` row, and creating one needs the admin API that `apps/web` may
-- not hold and must not (D14). Close registration and provisioning has nobody to hand a
-- business to. **An account is not a tenant** — it is the same precondition `addMember` has
-- always stated out loud, and it is now the precondition for being handed a business too.
--
-- **The function is not dropped, and that is deliberate.** It keeps the guard
-- 20260830000001 put inside it: an anonymous session -- a real `auth.uid()` from the booking
-- flow, bound to one tenant for the life of its binding (D22) -- may not found a business. That
-- was found the expensive way, by noticing that enabling anonymous sign-in silently widened
-- every grant written against `authenticated`. Dropping this function would throw the guard
-- away and make somebody rediscover it. It is the self-serve door with no key cut for it yet,
-- and D29 already names when the key gets cut: M8's onboarding flow, which is the somebody who
-- can do the configuring on that side.
--
-- **Rejected: leaving the grant and taking the form off the screen.** That is the closure this
-- repository refuses by name -- a route is not the authorization boundary and neither is a
-- missing button (I12). A direct PostgREST call would still found a tenant, which is exactly
-- what I16 exists to make impossible.

revoke execute on function public.create_organization(text, text, text[], text, text, text)
  from public, anon, authenticated;

comment on function public.create_organization(text, text, text[], text, text, text) is
  'The self-serve door, with no grant. Founds an organization and its first membership, making the caller the founder -- which is the one thing provision_organization cannot express. Executable by nobody until M8 gives self-serve somebody who can do the configuring (D29). Retains the anonymous-session guard from 20260830000001; do not drop it to re-create it later.';
