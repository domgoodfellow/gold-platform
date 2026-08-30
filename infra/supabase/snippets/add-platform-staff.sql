-- Add somebody to the platform staff list.
--
-- **Run by hand, with database access, and that is the whole design rather than a gap waiting
-- for a screen.** `platform_staff` has no insert policy and no grant to any application role,
-- because a screen that adds a colleague is a *staff write* — and D28's trigger to revisit is
-- exactly "the first thing platform staff must write". Until that decision is made, this is
-- how a colleague is added, and `platform-staff.test.ts` runs the same statement.
--
-- This is not `publish-bookable-type.sql`, which exists because an operator path is *owed* and
-- missing. Nothing is owed here.
--
-- **The person must already have signed up**, because the row references `auth.users`.
--
-- **Their next token carries the role, not their current one.** The claim is minted at
-- sign-in, so somebody promoted while signed in stays `authenticated` until they sign in
-- again. That is ordinary session behaviour and not something this axis invented.
--
-- **A staff account is a different account from an operator account.** The hook replaces the
-- `role` claim outright, so a user who is both staff and a member of an organization loses the
-- membership half while signed in: their tenant policies key on `authenticated` and they are
-- no longer wearing it. That is D28 working as intended — our people are not in a customer's
-- list of who works at their business — and it means one human who both runs GOLD and operates
-- a tenant needs two sign-ins.

insert into public.platform_staff (user_id, name)
select u.id, 'Their name here'
  from auth.users u
 where u.email = 'them@example.com'
on conflict (user_id) do nothing;

-- Who is staff today.
select s.name, u.email, s.created_at
  from public.platform_staff s
  join auth.users u on u.id = s.user_id
 order by s.created_at;

-- Remove somebody. Their next token is an ordinary one; the current one stands until it
-- expires, which is the same property every session in this system has.
-- delete from public.platform_staff where user_id = (
--   select id from auth.users where email = 'them@example.com'
-- );
