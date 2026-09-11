-- Product identifiers and module mappings remain deployment-owned, but staff may manage the
-- commercial presentation and sale state. No row is deleted: historical tenant terms and list
-- prices continue to reference the same stable key.

alter table public.platform_products
  add column description text not null default '',
  add column sale_status text not null default 'active'
    check (sale_status in ('active', 'unlisted', 'archived')),
  add column display_order integer not null default 100
    check (display_order >= 0);

create function public.update_platform_product(
  p_product_key text,
  p_label text,
  p_description text,
  p_sale_status text,
  p_display_order integer
) returns void language plpgsql volatile security definer set search_path = '' as $fn$
begin
  perform app.require_platform_staff();
  if length(btrim(p_label)) not between 1 and 120 then
    raise exception 'product label must be between 1 and 120 characters' using errcode = '22023';
  end if;
  if length(p_description) > 500 then
    raise exception 'product description must be at most 500 characters' using errcode = '22023';
  end if;
  if p_sale_status not in ('active', 'unlisted', 'archived') then
    raise exception 'unknown product sale status' using errcode = '22023';
  end if;
  if p_display_order < 0 then
    raise exception 'product display order must be non-negative' using errcode = '22023';
  end if;

  update public.platform_products
     set label = btrim(p_label),
         description = btrim(p_description),
         sale_status = p_sale_status,
         display_order = p_display_order
   where key = p_product_key;
  if not found then raise exception 'unknown product' using errcode = '22023'; end if;
end;
$fn$;

comment on function public.update_platform_product(text, text, text, text, integer) is
  'Staff-only mutable catalogue metadata. Product key, kind, and module mapping remain deployment-owned and historical rows are never deleted.';
revoke all on function public.update_platform_product(text, text, text, text, integer) from public;
grant execute on function public.update_platform_product(text, text, text, text, integer) to platform_staff;

-- A narrow aggregate lets the meter catalogue say whether a meter is used without granting
-- staff a new route into tenant-owned usage rows.
create function public.platform_meter_observations()
returns table (meter_id text, usage_event_count bigint)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform app.require_platform_staff();
  return query
    select u.meter_id, count(*)::bigint
      from public.usage_events u
     group by u.meter_id;
end;
$fn$;

revoke all on function public.platform_meter_observations() from public;
grant execute on function public.platform_meter_observations() to platform_staff;
