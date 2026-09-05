-- A business looks like itself, and the platform guarantees it stays readable.
--
-- **This is D23's per-tenant theme, and it is being built rather than deferred.** That record
-- rejects one by name and sends it to the marketing surface under D20, on the grounds that a
-- tenant choosing its own colours is "configuration with a renderer" needing the same evidence.
-- The evidence arrived, and it is not a hypothetical customer: this platform's own operator
-- screens read as a specification rather than as a product, and a business standing up its first
-- page has nothing on it that is theirs. `constraints.md` D23 is amended in the same change.
--
-- **What makes it cheap is that the deferral was honoured properly.** `ui-spec.md` §3 says a
-- control reads a variable and never a literal, "which is what makes a per-tenant theme a
-- question of where values come from rather than a second pass over every control". Seven roles
-- already exist in `globals.css` and every control already reads them. So this migration adds
-- where the values come from, and touches no control at all.
--
-- Three things it deliberately is not.
--
-- **It is not five colour pickers.** D23 records `mamouandco`'s `brand_settings` as having five
-- colour roles, and that shape does not survive being handed to a stranger: a tenant who picks
-- five colours has five ways to put unreadable text on their own screens, and the platform would
-- be shipping a product whose legibility it does not control. One colour is stored -- the one a
-- business actually has -- and every role derived from it is computed by
-- `lib/domain/branding/palette.ts`, which refuses to return a pair that fails WCAG AA. A
-- business gets its colour; nobody gets an unreadable button.
--
-- **It is not an arbitrary font.** A font is a file. A tenant typing a family name would either
-- do nothing or, worse, become a request to somebody else's server from every page this platform
-- renders on their behalf. The choice is a pair from a list this deployment actually ships, and
-- adding to that list is a change here and in the layout that loads it.
--
-- **It is not the marketing surface.** No pages, no blocks, no editor. D20's deferral of a
-- per-tenant *site* is untouched, and the thing that stayed deferred is the thing that was
-- actually blocked.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table public.brand_settings (
  -- I2: the tenant id, and here it is the whole key. One row per business, exactly as
  -- `organization_profiles` is, because a business has one look and not a list of them.
  organization_id uuid primary key references public.organizations (id) on delete cascade,

  -- **One colour, and null means this business has said nothing.** Null renders the platform's
  -- own neutral roles rather than a colour the platform chose on their behalf -- the same
  -- reading of silence operating hours and `organization_profiles` already have.
  --
  -- Lowercase six-digit hex, checked here so the column cannot hold something the renderer
  -- would have to guess at. Three-digit shorthand and named colours are refused rather than
  -- expanded: one spelling in the column means one answer to what this business's colour is.
  accent text check (accent is null or accent ~ '^#[0-9a-f]{6}$'),

  -- The pair, from the families this deployment loads. Not an enum: D6's reasoning holds for
  -- anything a tenant might rename, and while a font family is emphatically the platform's
  -- vocabulary rather than a tenant's, a check constraint says the same thing without a type to
  -- migrate when a fourth family ships.
  heading_font text check (heading_font is null or heading_font in ('sans', 'serif', 'mono')),
  body_font    text check (body_font    is null or body_font    in ('sans', 'serif', 'mono')),

  -- The object key in the `brand` bucket below, or null. A path rather than a URL, so that
  -- where the bytes are served from stays this platform's decision.
  logo_path text check (logo_path is null or length(btrim(logo_path)) between 1 and 500),

  updated_at timestamptz not null default now(),
  updated_by uuid        not null references auth.users (id)
);

comment on table public.brand_settings is
  'How one business looks: one colour, a font pair, a logo. Not the marketing surface -- no pages, no blocks, no editor. The colour is stored and the roles derived from it, so a tenant cannot make its own screens unreadable.';

alter table public.brand_settings enable row level security;
alter table public.brand_settings force row level security;

-- ---------------------------------------------------------------------------
-- Who may read it, and who may write it
-- ---------------------------------------------------------------------------

-- **Every member reads it, and that is not a leak -- it is the point.** A brand is rendered on
-- every screen of this business, so a member who could not read this row would see the platform's
-- neutral look while a colleague saw the business's. Nothing here is a secret; a logo is on a
-- public page by design.
create policy brand_settings_select on public.brand_settings
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Writing is `organization.manage`, the same capability that owns the name, the zone, what the
-- business trades in and its public profile. A brand is a claim a business makes about itself in
-- exactly the way a tagline is, so it is the same answer to the same question rather than a new
-- capability with no separate person behind it.
create policy brand_settings_insert on public.brand_settings
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and updated_by = (select auth.uid())
    and app.has_capability(organization_id, 'organization.manage')
  );

create policy brand_settings_update on public.brand_settings
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

-- **An outsider reads this, and that is what makes a public page look like the business.**
-- `/book/{slug}` and `/portal/{token}` are reached by somebody with no membership, and both
-- already read `organization_profiles` through exactly this policy shape.
--
-- **`to authenticated`, scoped by the binding -- not `to anon`.** D22's outsider holds a real
-- session from anonymous sign-in, so they arrive on the `authenticated` role like everybody
-- else, and `app.current_external_tenant()` returns the one business they are bound to. A
-- policy written `to anon` would be a second answer to *who is this stranger* on an axis that
-- already has one, and it would be the answer that is not scoped to a tenant.
create policy brand_settings_select_external on public.brand_settings
  for select to authenticated
  using (organization_id = (select app.current_external_tenant()));

-- Column grants rather than a table-wide one, because a table-wide grant is a promise about
-- every column this table will ever have -- and `updated_at` and `updated_by` are the platform's
-- to write. This has been found twice in this repository and both times two migrations each
-- assumed the other had it covered.
grant select on public.brand_settings to authenticated;
grant insert (organization_id, accent, heading_font, body_font, logo_path, updated_by)
  on public.brand_settings to authenticated;
grant update (accent, heading_font, body_font, logo_path, updated_by)
  on public.brand_settings to authenticated;

-- `updated_at` is maintained and is in no column grant above, so it cannot be backdated by the
-- caller that changed the row.
create function app.touch_brand_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger brand_settings_touch
  before update on public.brand_settings
  for each row execute function app.touch_brand_settings();

-- Staff read every tenant and write none (D28, I21). Select only, and no insert, update or
-- delete grant exists for the role on this table -- so a permissive policy added later still
-- meets a missing privilege.
grant select on public.brand_settings to platform_staff;

create policy brand_settings_select_staff on public.brand_settings
  for select to platform_staff
  using (true);

-- ---------------------------------------------------------------------------
-- Where a logo lives
-- ---------------------------------------------------------------------------

-- **`public = true`, and it is the one bucket in this database that is.** `constraints.md` is
-- unambiguous that a private file is never served from a durable public URL, and every reason it
-- gives -- contracts, recordings, employee records -- is about a file whose *existence* is
-- confidential. A logo is the opposite kind of object: its whole purpose is to be on a page a
-- stranger opens, and minting a signed URL for it would mean a booking page that cannot be
-- cached and a logo that expires. The rule is about private files and this is not one.
--
-- What does not relax is who may write. The path prefix is the organization id, enforced by
-- policy exactly as `documents` enforces it, so a business can only put bytes under its own id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('brand', 'brand', true, 2097152)
on conflict (id) do nothing;

comment on column public.brand_settings.logo_path is
  'Object key in the public `brand` bucket. Public because a logo is published by definition -- the private-file rule is about files whose existence is confidential, which a logo is not.';

create policy brand_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand'
    and (storage.foldername(name))[1] in (
      select t::text from app.current_tenant_ids() t
    )
  );

create policy brand_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand'
    and (storage.foldername(name))[1] in (
      select t::text from app.current_tenant_ids() t
    )
  );

-- Replacing a logo removes the bytes it replaced. Unlike `documents`, where deleting is a
-- feature with no caller yet, here the caller exists in the same change: a business that uploads
-- a second logo would otherwise leave the first one readable at a durable public URL forever.
create policy brand_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brand'
    and (storage.foldername(name))[1] in (
      select t::text from app.current_tenant_ids() t
    )
  );

-- ---------------------------------------------------------------------------
-- Writing it
-- ---------------------------------------------------------------------------

-- **Two functions rather than one, because they are two acts.** Choosing a colour and a pair of
-- fonts is one sitting at a form; putting a logo up is an upload with bytes behind it. One
-- function taking all four would mean the colour form had to carry the logo path in a hidden
-- field to avoid clearing it — a shape where forgetting a field silently deletes something.
--
-- `security invoker`, so `brand_settings_insert` and `brand_settings_update` decide. The
-- function exists to make one write path with one event, never to reach past a policy.
create function public.set_brand_settings(
  p_organization_id uuid,
  p_accent          text,
  p_heading_font    text,
  p_body_font       text
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
    raise exception 'set_brand_settings requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Empty means unset, exactly as it does for a tagline: a business clearing its colour is
  -- saying something, and it must land back on the platform's neutral roles rather than on a
  -- stored empty string the renderer would have to interpret.
  insert into public.brand_settings as b
    (organization_id, accent, heading_font, body_font, updated_by)
  values (
    p_organization_id,
    nullif(btrim(lower(p_accent)), ''),
    nullif(btrim(p_heading_font), ''),
    nullif(btrim(p_body_font), ''),
    v_actor
  )
  on conflict (organization_id) do update
    set accent       = excluded.accent,
        heading_font = excluded.heading_font,
        body_font    = excluded.body_font,
        updated_by   = excluded.updated_by
  where b.organization_id in (select app.current_tenant_ids());

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'organization.brand_updated',
     jsonb_build_object(
       'accent', nullif(btrim(lower(p_accent)), ''),
       'heading_font', nullif(btrim(p_heading_font), ''),
       'body_font', nullif(btrim(p_body_font), '')
     ));
end;
$fn$;

revoke all on function public.set_brand_settings(uuid, text, text, text) from public;
grant execute on function public.set_brand_settings(uuid, text, text, text) to authenticated;

-- The logo alone, so uploading one cannot clear a colour and choosing a colour cannot clear a
-- logo. Null clears it, which is how a business takes its logo down.
create function public.set_brand_logo(p_organization_id uuid, p_logo_path text)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'set_brand_logo requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.brand_settings as b
    (organization_id, logo_path, updated_by)
  values (p_organization_id, nullif(btrim(p_logo_path), ''), v_actor)
  on conflict (organization_id) do update
    set logo_path  = excluded.logo_path,
        updated_by = excluded.updated_by
  where b.organization_id in (select app.current_tenant_ids());

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'organization.brand_updated',
     jsonb_build_object('logo_path', nullif(btrim(p_logo_path), '')));
end;
$fn$;

revoke all on function public.set_brand_logo(uuid, text) from public;
grant execute on function public.set_brand_logo(uuid, text) to authenticated;
