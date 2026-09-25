-- Every SECURITY DEFINER function in `app` held the default EXECUTE for PUBLIC. `app` is not an
-- exposed schema and only `authenticated` holds USAGE on it, which is a reason the grant was never
-- reachable and not a reason to leave it: a later change to either fact would have opened them
-- all at once. A privileged function is executable by the roles that need it and by nobody else.
--
-- Trigger functions are fired by the trigger, which checks EXECUTE once at CREATE TRIGGER and
-- never again, and the definer functions the machine roles reach are called from inside other
-- definer functions that run as their owner. Neither needs the grant this removes.

-- Superseded by `grant_founding_terms` (D41), which `create_organization` and
-- `provision_organization` call instead. Nothing reaches it, and it inserted module rows for any
-- organization and actor it was handed.
drop function app.enable_default_modules(uuid, uuid);

revoke all on function
  app.check_launch_readiness(),
  app.automation_conditions_hold(uuid, public.work_items),
  app.check_module_entitlement(),
  app.check_role_capabilities_update(),
  app.due_reading_automations(),
  app.due_scheduled_automations(interval),
  app.fire_counter_automations(),
  app.fire_event_automations(),
  app.forget_stale_readings(),
  app.open_call_legs(),
  app.phone_number_owner(text),
  app.propagate_buffer(),
  app.propagate_status_release(),
  app.resolve_message_template(text, public.work_items),
  app.touch_brand_settings(),
  app.touch_telephony_settings()
from public;

-- `module_enabled` and `assert_module_enabled` were granted to `anon` and `authenticated` by name.
-- Only `create_booking`, `claim_portal_invite` and `publishes_bookings`, all definer, call them, so
-- the grant served nothing and let any signed-in role ask whether another business had a module on.
revoke all on function app.module_enabled(uuid, text), app.assert_module_enabled(uuid, text)
  from public, anon, authenticated;

-- The one that is called by a person's own session: `set_calling_number` is `security invoker`,
-- so `phone_number_owner` runs as `authenticated`. Granted by name so the exception is visible.
grant execute on function app.phone_number_owner(text) to authenticated;
