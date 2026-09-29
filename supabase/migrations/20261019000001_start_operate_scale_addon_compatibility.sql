-- F1 follow-up: `platform_plan_addons` (20261018000001) exists but no Plan -- old or new -- has a
-- single compatibility row yet. Start, Operate, Scale and Enterprise (20261015000002) need real
-- ones so their Economics tab's Add-ons list is the actual commercial offer, not every Add-on in
-- the catalogue shown as equally attachable. None are `included_by_default`: every Add-on here is
-- a genuine optional upsell, never bundled silently into a base Plan's price.
--
-- Direct inserts, not `attach_plan_addon()` -- that RPC checks `app.require_platform_staff()`
-- against `auth.uid()`, which is null in a migration's session, the same reason
-- `20261018000001`'s own seed section inserts `platform_meter_cost_model_components` directly
-- rather than calling `set_meter_cost_model_component()`.
--
-- additional_user / local_phone_number / standard_implementation / advanced_migration: relevant to
-- any tier, so attached to all four. additional_caller: only tiers with a calling_users quota
-- (Operate, Scale; Enterprise negotiates its own). ai_lite / ai_pro: every tier already reaches the
-- Agents product's `intelligence` module (Start and Operate explicitly, Scale/Enterprise via the
-- whole Product grant), so AI capacity is the same upsell everywhere. advanced_routing /
-- premium_support: reserved for Scale and Enterprise, where the volume they address actually
-- exists.

insert into public.platform_plan_addons (plan_id, addon_plan_id, included_by_default)
select base.id, addon.id, false
  from public.platform_plans base
  cross join public.platform_plans addon
 where base.key in ('start', 'operate', 'scale', 'enterprise')
   and addon.key in ('additional_user', 'local_phone_number', 'standard_implementation', 'advanced_migration', 'ai_lite', 'ai_pro')
on conflict do nothing;

insert into public.platform_plan_addons (plan_id, addon_plan_id, included_by_default)
select base.id, addon.id, false
  from public.platform_plans base
  cross join public.platform_plans addon
 where base.key in ('operate', 'scale', 'enterprise')
   and addon.key = 'additional_caller'
on conflict do nothing;

insert into public.platform_plan_addons (plan_id, addon_plan_id, included_by_default)
select base.id, addon.id, false
  from public.platform_plans base
  cross join public.platform_plans addon
 where base.key in ('scale', 'enterprise')
   and addon.key in ('advanced_routing', 'premium_support')
on conflict do nothing;
