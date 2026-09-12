-- The first guard established the six section kinds. Close the objects as well: adding a field
-- called `html`, `component` or `script` must not turn a future renderer into an accidental CMS
-- escape hatch. Text remains text and React escapes it.

create function app.jsonb_has_only_keys(p_value jsonb,p_keys text[])
returns boolean language sql immutable set search_path='' as $fn$
  select jsonb_typeof(p_value)='object' and not exists (
    select 1 from jsonb_object_keys(p_value) key where not (key=any(p_keys))
  );
$fn$;

create function app.public_link_is_valid(p_value jsonb)
returns boolean language sql immutable set search_path='' as $fn$
  select app.jsonb_has_only_keys(p_value,array['label','href'])
    and jsonb_typeof(p_value->'label')='string'
    and length(btrim(p_value->>'label')) between 1 and 80
    and jsonb_typeof(p_value->'href')='string'
    and (p_value->>'href') ~ '^(\/[A-Za-z0-9\-\/_]*|#[A-Za-z][A-Za-z0-9-]*)$';
$fn$;

create function app.public_text_items_are_valid(p_value jsonb,p_max integer)
returns boolean language sql immutable set search_path='' as $fn$
  select jsonb_typeof(p_value)='array' and jsonb_array_length(p_value) between 1 and p_max
    and coalesce((select bool_and(
      app.jsonb_has_only_keys(item,array['title','body'])
      and jsonb_typeof(item->'title')='string' and length(btrim(item->>'title')) between 1 and 120
      and jsonb_typeof(item->'body')='string' and length(btrim(item->>'body')) between 1 and 500
    ) from jsonb_array_elements(p_value) item),false);
$fn$;

create function app.public_process_items_are_valid(p_value jsonb)
returns boolean language sql immutable set search_path='' as $fn$
  select jsonb_typeof(p_value)='array' and jsonb_array_length(p_value) between 1 and 6
    and coalesce((select bool_and(
      app.jsonb_has_only_keys(item,array['step','title','body'])
      and jsonb_typeof(item->'step')='string' and length(btrim(item->>'step')) between 1 and 12
      and jsonb_typeof(item->'title')='string' and length(btrim(item->>'title')) between 1 and 120
      and jsonb_typeof(item->'body')='string' and length(btrim(item->>'body')) between 1 and 500
    ) from jsonb_array_elements(p_value) item),false);
$fn$;

create or replace function app.public_homepage_sections_are_valid(p_sections jsonb)
returns boolean language sql immutable set search_path='' as $fn$
  select jsonb_typeof(p_sections)='array' and jsonb_array_length(p_sections)=6
    and p_sections->0->>'kind'='hero' and p_sections->1->>'kind'='problem'
    and p_sections->2->>'kind'='capabilities' and p_sections->3->>'kind'='process'
    and p_sections->4->>'kind'='trust' and p_sections->5->>'kind'='cta'
    and coalesce((select bool_and(case item->>'kind'
      when 'hero' then app.jsonb_has_only_keys(item,array['kind','eyebrow','heading','body','primaryCta','secondaryCta'])
        and length(btrim(item->>'eyebrow')) between 1 and 100 and length(btrim(item->>'heading')) between 1 and 160
        and length(btrim(item->>'body')) between 1 and 600 and app.public_link_is_valid(item->'primaryCta') and app.public_link_is_valid(item->'secondaryCta')
      when 'problem' then app.jsonb_has_only_keys(item,array['kind','heading','paragraphs'])
        and length(btrim(item->>'heading')) between 1 and 240 and jsonb_typeof(item->'paragraphs')='array'
        and jsonb_array_length(item->'paragraphs') between 1 and 4
        and not exists (select 1 from jsonb_array_elements(item->'paragraphs') paragraph where jsonb_typeof(paragraph)<>'string' or length(btrim(paragraph#>>'{}')) not between 1 and 600)
      when 'capabilities' then app.jsonb_has_only_keys(item,array['kind','eyebrow','heading','body','items'])
        and length(btrim(item->>'eyebrow')) between 1 and 100 and length(btrim(item->>'heading')) between 1 and 240
        and length(btrim(item->>'body')) between 1 and 600 and app.public_text_items_are_valid(item->'items',9)
      when 'process' then app.jsonb_has_only_keys(item,array['kind','eyebrow','heading','items'])
        and length(btrim(item->>'eyebrow')) between 1 and 100 and length(btrim(item->>'heading')) between 1 and 240
        and app.public_process_items_are_valid(item->'items')
      when 'trust' then app.jsonb_has_only_keys(item,array['kind','eyebrow','heading','items'])
        and length(btrim(item->>'eyebrow')) between 1 and 100 and length(btrim(item->>'heading')) between 1 and 240
        and app.public_text_items_are_valid(item->'items',6)
      when 'cta' then app.jsonb_has_only_keys(item,array['kind','heading','body','primaryCta','secondaryCta'])
        and length(btrim(item->>'heading')) between 1 and 240 and length(btrim(item->>'body')) between 1 and 600
        and app.public_link_is_valid(item->'primaryCta') and app.public_link_is_valid(item->'secondaryCta')
      else false end) from jsonb_array_elements(p_sections) item),false);
$fn$;

create function app.prevent_published_revision_delete()
returns trigger language plpgsql set search_path='' as $fn$
begin
  if old.status in ('published','archived') then
    raise exception 'a published public page revision is immutable' using errcode='55000';
  end if;
  return old;
end;
$fn$;

create trigger public_page_published_revision_cannot_be_deleted
before delete on public.public_page_revisions
for each row execute function app.prevent_published_revision_delete();
