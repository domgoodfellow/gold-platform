-- What a business says about itself on a page the public can see.
--
-- **This exists because the booking surface broke a Never.** `constraints.md`: "Never hardcode
-- a claim a business makes about itself -- guarantees, trust points, service assertions,
-- section headings. Copy is configuration." The booking page shipped with "Book a time",
-- "This business is not taking bookings online at the moment", and a timezone note, on a URL a
-- business puts on the side of a van. Every one of those is the platform speaking in a
-- business's voice.
--
-- **D20 assumed booking could ship before marketing, and it cannot.** That record defers the
-- marketing surface because "every word on a public page a business shows the world is a claim
-- that business makes about itself" -- and then permits booking, which is a public page. The
-- two are the same problem and the second one arrived first.
--
-- What this is *not* is the marketing surface. There are no pages, no sections, no blocks and
-- no editor; there is one row of copy, rendered at the top of whatever public surface a tenant
-- has. **No colour, either** -- D23 rejects a per-tenant theme by name and says it "lands with
-- the marketing surface under D20 and needs the same evidence". Copy is what the Never is
-- about; a palette is a different feature and has not earned its way in.
--
-- **A separate table rather than more columns on `organizations`.** The kernel row is what the
-- platform needs to operate a tenant -- the clock it thinks in, what it trades in. This is what
-- the tenant says to strangers. Keeping them apart means a business that has said nothing has
-- no row, which is the same shape operating hours and the buffer already use, and it means
-- `update_organization` does not grow a twelfth argument.

create table public.organization_profiles (
  organization_id uuid        primary key references public.organizations (id) on delete cascade,

  -- Null falls back to `organizations.name`, so a business that has configured nothing still
  -- renders **its own name** rather than a platform sentence. "It has said nothing" must never
  -- resolve to the platform saying something on its behalf.
  display_name    text        check (display_name is null or length(btrim(display_name)) between 1 and 200),

  -- The line under the name. A claim the business makes, which is exactly why it is a row.
  tagline         text        check (tagline is null or length(btrim(tagline)) <= 200),
  intro           text        check (intro is null or length(btrim(intro)) <= 2000),

  -- How to reach them without going through this platform. A booking page that offers no way
  -- to phone somebody is a worse page than the one it replaced.
  contact_email   text        check (contact_email is null or length(btrim(contact_email)) <= 200),
  contact_phone   text        check (contact_phone is null or length(btrim(contact_phone)) <= 50),
  address         text        check (address is null or length(btrim(address)) <= 500),

  updated_at      timestamptz not null default now(),
  updated_by      uuid        not null references auth.users (id)
);

comment on table public.organization_profiles is
  'A business''s own words on its public surface. Not the marketing surface -- one row, no pages, no blocks, no theme. Exists because copy is configuration and the booking page is public.';

alter table public.organization_profiles enable row level security;
alter table public.organization_profiles force row level security;

create policy organization_profiles_select on public.organization_profiles
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- The public half. Read by a visitor bound to this business, on the same axis as everything
-- else out there -- and the point of the table is that it is meant to be read by strangers.
create policy organization_profiles_select_external on public.organization_profiles
  for select to authenticated
  using (organization_id = app.current_external_tenant());

-- No new capability. `organization.manage` already means "change this business's own settings",
-- and what a business says about itself is settings rather than a new kind of authority --
-- inventing `profile.manage` would be vocabulary nobody could act on differently.
create policy organization_profiles_insert on public.organization_profiles
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and updated_by = (select auth.uid())
    and app.has_capability(organization_id, 'organization.manage')
  );

create policy organization_profiles_update on public.organization_profiles
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

grant select, insert on public.organization_profiles to authenticated;
grant update (display_name, tagline, intro, contact_email, contact_phone, address, updated_at, updated_by)
  on public.organization_profiles to authenticated;

create function public.set_organization_profile(
  p_organization_id uuid,
  p_display_name    text,
  p_tagline         text,
  p_intro           text,
  p_contact_email   text,
  p_contact_phone   text,
  p_address         text
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'set_organization_profile requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Upsert, because "has this business written a public page yet" is not a question any caller
  -- should have to ask. Every field is nullable and empty means unset: a business clearing its
  -- tagline is saying something, and storing '' would render an empty line rather than nothing.
  insert into public.organization_profiles as p
    (organization_id, display_name, tagline, intro, contact_email, contact_phone, address, updated_by)
  values (
    p_organization_id,
    nullif(btrim(p_display_name), ''),
    nullif(btrim(p_tagline), ''),
    nullif(btrim(p_intro), ''),
    nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_address), ''),
    v_actor
  )
  on conflict (organization_id) do update
    set display_name  = excluded.display_name,
        tagline       = excluded.tagline,
        intro         = excluded.intro,
        contact_email = excluded.contact_email,
        contact_phone = excluded.contact_phone,
        address       = excluded.address,
        updated_at    = now(),
        updated_by    = excluded.updated_by
  where p.organization_id in (select app.current_tenant_ids());

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'organization.profile_updated',
     jsonb_build_object('display_name', nullif(btrim(p_display_name), '')));
end;
$fn$;

revoke all on function public.set_organization_profile(uuid, text, text, text, text, text, text) from public;
grant execute on function public.set_organization_profile(uuid, text, text, text, text, text, text) to authenticated;
