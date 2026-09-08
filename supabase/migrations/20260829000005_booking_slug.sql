-- A business's public name for itself, and the end of the uuid in a public URL.
--
-- The booking surface shipped at `/book/{organizationId}`, and that was wrong twice over.
--
-- **It published a tenant id.** A link a business puts on its own website, in a text message
-- and on the side of a van cannot be `/book/8f3a...`. That is not a cosmetic complaint: the
-- identifier is internal, it is the value every `organization_id` column holds, and handing it
-- to the public is the sort of thing that is free to do and impossible to take back.
--
-- **And it made a path segment decide which tenant an anonymous visitor is bound to.** D17 is
-- explicit that resolving the tenant from a path segment is "routing convenience, never an
-- authorization input" -- `/organizations/[organizationId]` is safe precisely because RLS
-- re-derives membership regardless of what the URL claims. Out here there is no membership to
-- re-derive against, so the segment was the whole of it.
--
-- What replaces it is a name the business chose, resolved through a function that answers only
-- for businesses that have actually published something bookable. A tenant that has not opted
-- in has no public presence at all -- previously anyone holding a uuid could bind themselves to
-- any organization, and although they could then see nothing, the binding existed.

alter table public.organizations
  add column slug text
    constraint organizations_slug_format
    check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,62}$');

comment on column public.organizations.slug is
  'What this business is called in a public URL. Null until it wants a public surface; the platform never invents one from the name.';

-- Null until a business asks for one. **The platform does not derive it from the name**, which
-- would be the platform naming a business -- and the first tenant called "Smith & Sons" would
-- discover the platform had opinions about apostrophes.
create unique index organizations_slug_unique
  on public.organizations (slug)
  where slug is not null;

-- ---------------------------------------------------------------------------
-- Resolving one, from outside
-- ---------------------------------------------------------------------------

-- **The chicken-and-egg this exists to break.** Every policy on the external axis keys on
-- `app.current_external_tenant()`, which reads the binding -- and the binding cannot be created
-- until the organization is known. A visitor arriving with a slug and no binding can therefore
-- read nothing at all, including the row that would tell them which business they are looking
-- at.
--
-- So this is privileged, and narrow to the point of being uninteresting: one uuid, for a slug
-- somebody already typed, and **only for a business that has published something bookable**.
-- That last clause is the useful half -- it makes the public directory opt-in, so a tenant with
-- no bookable types is not addressable from outside at all.
-- `public`, not `app`, and that is not a slip. Everything in `app` is machinery for policies
-- and is deliberately unreachable from outside -- PostgREST exposes `public` alone. This one is
-- meant to be called by a visitor, so it lives where callable things live, and its narrowness
-- is carried by its body rather than by its address.
create function public.booking_organization(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id
  from public.organizations o
  where o.slug = lower(btrim(p_slug))
    and exists (
      select 1
      from public.work_item_types t
      where t.organization_id = o.id
        and t.booking_status_id is not null
    );
$fn$;

comment on function public.booking_organization(text) is
  'Slug to organization id, for a caller who has no binding yet and therefore no RLS scope. Answers only for businesses that publish a bookable type, so the public directory is opt-in.';

revoke all on function public.booking_organization(text) from public;
grant execute on function public.booking_organization(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Setting it
-- ---------------------------------------------------------------------------

grant update (name, timezone, currency, buffer_minutes, slug) on public.organizations to authenticated;

drop function public.update_organization(uuid, text, text, text, integer);

create function public.update_organization(
  p_id             uuid,
  p_name           text,
  p_timezone       text,
  p_currency       text,
  p_buffer_minutes integer,
  p_slug           text
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'update_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Changing the currency does NOT reinterpret what past jobs cost: every amount carries the
  -- currency it was recorded in, snapshotted at insert (I8). Changing the timezone does not
  -- move any instant either -- an instant is absolute, and only its rendering changes (I9).
  --
  -- Changing the buffer *does* reach existing work, through a trigger, and that is deliberate:
  -- a business that discovers it needs forty minutes between jobs means it about tomorrow's
  -- bookings. Widening far enough to overlap two committed jobs raises 23P01.
  --
  -- Changing the slug breaks every link the business has already shared. That is the business's
  -- decision to make and the platform does not second-guess it; there is no redirect table,
  -- because nothing has asked for one.
  update public.organizations
     set name           = p_name,
         timezone       = p_timezone,
         currency       = p_currency,
         buffer_minutes = p_buffer_minutes,
         slug           = nullif(lower(btrim(p_slug)), '')
   where id = p_id
  returning id into v_org;

  if v_org is null then
    raise exception 'no such organization, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_id, v_actor, 'organization', p_id, 'organization.updated',
     jsonb_build_object(
       'name', p_name,
       'timezone', p_timezone,
       'currency', p_currency,
       'buffer_minutes', p_buffer_minutes,
       'slug', nullif(lower(btrim(p_slug)), '')
     ));
end;
$fn$;

revoke all on function public.update_organization(uuid, text, text, text, integer, text) from public;
grant execute on function public.update_organization(uuid, text, text, text, integer, text) to authenticated;
