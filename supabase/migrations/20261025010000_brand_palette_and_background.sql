-- Organization brand palette and personal background treatment (V1.4 final acceptance, Phase B).
--
-- Branding stays organization-owned and Appearance stays account-owned; they are not merged.
-- * brand_settings gains two optional colours. The existing `accent` column remains the primary
--   colour, so every legacy single-colour brand keeps exactly its visible primary with no data
--   rewrite. `secondary` and `highlight` are null until a business chooses them.
-- * set_brand_palette writes all colours and fonts in one act, security invoker like
--   set_brand_settings, so the existing organization.manage policies decide. set_brand_settings is
--   kept unchanged for compatibility (it never touches the new columns).
-- * account_appearance_preferences gains an optional background treatment. Null means none, which
--   is the existing look; existing rows are not changed.

alter table public.brand_settings
  add column secondary text check (secondary is null or secondary ~ '^#[0-9a-f]{6}$'),
  add column highlight text check (highlight is null or highlight ~ '^#[0-9a-f]{6}$');

comment on column public.brand_settings.accent is
  'Primary brand colour (main identity, primary actions, selected states). Named accent for compatibility.';
comment on column public.brand_settings.secondary is
  'Optional supporting colour for secondary decorative accents. Null: derived from the primary at render time.';
comment on column public.brand_settings.highlight is
  'Optional emphasis colour for non-semantic highlights. Null: the primary is used.';

grant insert (secondary, highlight) on public.brand_settings to authenticated;
grant update (secondary, highlight) on public.brand_settings to authenticated;

create function public.set_brand_palette(
  p_organization_id uuid,
  p_accent          text,
  p_secondary       text,
  p_highlight       text,
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
    raise exception 'set_brand_palette requires an authenticated caller' using errcode = '42501';
  end if;

  insert into public.brand_settings as b
    (organization_id, accent, secondary, highlight, heading_font, body_font, updated_by)
  values (
    p_organization_id,
    nullif(btrim(lower(p_accent)), ''),
    nullif(btrim(lower(p_secondary)), ''),
    nullif(btrim(lower(p_highlight)), ''),
    nullif(btrim(p_heading_font), ''),
    nullif(btrim(p_body_font), ''),
    v_actor
  )
  on conflict (organization_id) do update
    set accent       = excluded.accent,
        secondary    = excluded.secondary,
        highlight    = excluded.highlight,
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
       'secondary', nullif(btrim(lower(p_secondary)), ''),
       'highlight', nullif(btrim(lower(p_highlight)), ''),
       'heading_font', nullif(btrim(p_heading_font), ''),
       'body_font', nullif(btrim(p_body_font), '')
     ));
end;
$fn$;

revoke all on function public.set_brand_palette(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.set_brand_palette(uuid, text, text, text, text, text) to authenticated;

alter table public.account_appearance_preferences
  add column background text check (background is null or background in ('none', 'gradient', 'grid', 'ambient3d'));

comment on column public.account_appearance_preferences.background is
  'Optional decorative background treatment for designated decorative regions. Null keeps the neutral surface.';

notify pgrst, 'reload schema';
