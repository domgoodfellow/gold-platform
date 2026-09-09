-- The refusal D41 specifies: a module that is wanted but not currently paid for goes read-only,
-- never dark.
--
-- **A trigger, not a policy** -- D41's own reasoning, restated: a policy makes a row disappear
-- and cannot say why, which turns a late-recorded term into an operator locked out mid-task with
-- "permission denied" and nothing to read. A trigger is the shape this schema already uses
-- wherever a refusal has to explain itself (`app.check_status_transition`,
-- `app.check_work_item_update_capability`), and it can still name the module and say nothing was
-- deleted.
--
-- **One table in this slice, and the gap is named rather than hidden.** D41 already says nobody
-- has written down which tables each module owns. Doing that for booking, portal, assistant and
-- reception is real work belonging to a later change. `payment_accounts` (`card_payments`) is
-- the pilot: one table, one module, already D31's own example of a switch that can mislead if
-- what's behind it isn't real. The remaining five optional modules' tables are not yet wired to
-- this trigger -- `docs/domain-model.md`'s new invariant cell says so rather than implying
-- coverage that doesn't exist.

create function app.check_module_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_module text := tg_argv[0];
  v_wanted boolean;
begin
  select true into v_wanted
    from public.organization_modules m
   where m.organization_id = new.organization_id
     and m.module_key = v_module;

  if v_wanted is null then
    -- Not wanted at all is a different refusal from lapsed, and not this trigger's to give --
    -- the module's own switch, or a capability policy, already has its own reason for refusing
    -- (or the caller had no business writing this row in the first place).
    return new;
  end if;

  if app.module_paid(new.organization_id, v_module) then
    return new;
  end if;

  raise exception
    'the % module is switched on but nothing is currently paid for it -- nothing already recorded was deleted, and GOLD can record a term to restore it',
    v_module
    using errcode = '42501';
end;
$fn$;

comment on function app.check_module_entitlement() is
  'D41''s refusal, generic: an insert/update to a module-owned table is refused when that module is wanted but not currently paid for. Reads are never this trigger''s concern -- nothing a business already recorded becomes unreadable when a term lapses. Attach with `execute function app.check_module_entitlement(''<module_key>'')`.';

create trigger payment_accounts_check_entitlement
  before insert on public.payment_accounts
  for each row
  execute function app.check_module_entitlement('card_payments');
