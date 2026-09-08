-- A business's own calling number.
--
-- **What this closes.** Reception shipped complete from the carrier inwards — signed webhooks, a
-- conference per call, legs as rows, recordings — and with nothing in the product to point any of
-- it at. `callingNumber()` read `TELEPHONY_FROM_NUMBER`, one environment variable for the whole
-- deployment, so every business on it dialled from the same number or none did. A module with a
-- switch and no route to its inputs is exactly what D31 exists to prevent, and what card payments
-- did before it.
--
-- **An identifier, never a credential** (D39). What a business stores here is the number it dials
-- from. It grants nothing on its own: the carrier account remains GOLD's, the subaccount under it
-- is what isolates one business from another, and no secret of any kind lands in this table. The
-- shape D27 refused for payments — a tenant pasting a vendor's auth token into a settings form —
-- is refused here for the same reason.
--
-- **A table rather than a column on `organizations`.** Two reasons, and the second is the one that
-- decides it. A column would mean re-granting the whole update list on that table
-- (`name, timezone, currency, buffer_minutes, slug`), which is the promise-about-every-column
-- mistake this repository has made twice. And `organizations` is the kernel: a setting that only
-- exists because a business switched a module on does not belong on the row every business has.
--
-- Modelled on `brand_settings` (20260904000002) down to the column grants and the touch trigger,
-- because it is the same shape of thing — one row of settings per organization, written through
-- one function that also writes the event.

create table public.telephony_settings (
  -- Primary key *is* the tenant key, so I2's "lead every unique index with it" holds trivially.
  organization_id uuid primary key references public.organizations (id) on delete cascade,

  -- E.164, the same expression `calls.from_number` already checks. Written twice deliberately:
  -- a number that passes here and fails there would be a row that can be saved and never used.
  -- Null is a real answer and the default one — a business that has said nothing, which is not
  -- the same as a business that said nothing works.
  calling_number  text        check (calling_number ~ '^\+[1-9][0-9]{7,14}$'),

  updated_at      timestamptz not null default now(),
  updated_by      uuid        references auth.users (id)
);

comment on table public.telephony_settings is
  'The number one business dials from. An identifier and never a credential (D39): the carrier account is GOLD''s, and nothing here grants anything on its own.';

-- Both, and `force` is the half that is easy to forget: without it the table's owner bypasses
-- every policy below, so the row would be readable by anything connecting as that role. I1
-- requires the pair, and `schema-conformance.test.ts` reads `pg_class` for it rather than
-- trusting a migration to have said so.
alter table public.telephony_settings enable row level security;
alter table public.telephony_settings force  row level security;

-- Reading it is ordinary membership: the dialer needs the number on every call, and every member
-- who may place one must be able to read what they are calling from.
create policy telephony_settings_select on public.telephony_settings
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- **`organization.manage`, not `field.manage`.** 20260828000003 drew that line and it decides
-- this: naming a board column is configuring how a business records work, while the number its
-- customers see when it rings them is the business itself. It sits with currency and the clock.
create policy telephony_settings_insert on public.telephony_settings
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

create policy telephony_settings_update on public.telephony_settings
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

-- **No external policy and no staff policy, because neither has a caller.** An outsider on a
-- booking page has no use for this, and the platform console does not show it. Both are one line
-- to add the day something reads them, and adding them now would be two policies nothing tests.

-- Column grants rather than a table-wide one: a table-wide grant is a promise about every column
-- this table will ever have, and `updated_at` is the platform's to write.
grant select on public.telephony_settings to authenticated;
grant insert (organization_id, calling_number, updated_by)
  on public.telephony_settings to authenticated;
grant update (calling_number, updated_by)
  on public.telephony_settings to authenticated;

-- `updated_at` is in no grant above, so the caller that changed the row cannot backdate it.
create function app.touch_telephony_settings()
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

create trigger telephony_settings_touch
  before update on public.telephony_settings
  for each row execute function app.touch_telephony_settings();

-- ---------------------------------------------------------------------------
-- Writing it
-- ---------------------------------------------------------------------------

-- `security invoker`: the two policies above decide, and this function adds no authority of its
-- own. It exists to make one write path with one event, never to reach past a policy.
create function public.set_calling_number(p_organization_id uuid, p_number text)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_number text := nullif(btrim(p_number), '');
begin
  if v_actor is null then
    raise exception 'set_calling_number requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Empty clears it, exactly as it does for a tagline or a brand colour. A business taking its
  -- number down is saying something, and it must land back on "cannot dial" rather than on a
  -- stored empty string that would fail the check constraint on the way in.
  insert into public.telephony_settings as t
    (organization_id, calling_number, updated_by)
  values (p_organization_id, v_number, v_actor)
  on conflict (organization_id) do update
    set calling_number = excluded.calling_number,
        updated_by     = excluded.updated_by
  where t.organization_id in (select app.current_tenant_ids());

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id,
     'organization.calling_number_set',
     -- The business's own published number, not a customer's, and not a secret.
     jsonb_build_object('calling_number', v_number));
end;
$fn$;

comment on function public.set_calling_number(uuid, text) is
  'One write path and one event for the number a business dials from. security invoker: telephony_settings_insert/update decide.';

revoke all on function public.set_calling_number(uuid, text) from public;
grant execute on function public.set_calling_number(uuid, text) to authenticated;
