-- A business gives GildOps a private value to use for one stated purpose, and nobody reads it back.
--
-- Three credential models already exist and none of them fits: `platform_provider_accounts` is
-- GildOps' own account with a vendor, `integration_connections` is a business's delegated sign-in
-- to somebody else's account, and `organization_provider_resources.secret_id` is a credential
-- GildOps generated for a resource it provisioned. A **Secret Reference** is the fourth thing: a
-- value a business typed in -- a webhook signing secret, a key for its own API, a credential for
-- an app GildOps will deploy for it -- held in Vault, described by one row here.
--
-- *Which* of those a value is decides who owns it. This one is the business's, which is why the
-- door that writes it is the business's own (`secret.manage`), and why GildOps' staff hold no door
-- onto it at all: staff may bring a tenant into existence and never reach into one (I21).
--
-- One owner, always an organization. There is no project or deployment scope here: nothing yet
-- stores a Studio project or a deployment, so a scope column would be a promise with no caller.
-- A deployment that needs a secret names the key it requires and binds it to one of these rows in
-- its own table, with a composite key leading with `organization_id`, when that table exists.

-- ---------------------------------------------------------------------------
-- Its own capability: a secret is more sensitive than "connect a data source"
-- ---------------------------------------------------------------------------

do $$
declare
  v_capabilities text[];
  v_constraint   text;
begin
  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass
     and c.conname = 'roles_capabilities_known';

  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[])
    into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  if not ('secret.manage' = any (v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'secret.manage');

    alter table public.roles drop constraint roles_capabilities_known;
    execute format(
      'alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
      (select string_agg(quote_literal(capability), ', ' order by capability)
         from unnest(v_capabilities) as capability)
    );
  end if;
end
$$;

-- Only onto a role that already both changes the business's settings and connects its systems:
-- that is the administrator, not everyone who can connect a spreadsheet.
update public.roles
   set capabilities = capabilities || array['secret.manage']::text[]
 where 'organization.manage' = any (capabilities)
   and 'integration.manage' = any (capabilities)
   and not ('secret.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- The machine role that alone may read a value back
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000a9')
on conflict (id) do nothing;

-- 00000000-0000-4000-8000-0000000000a9 is the secret-resolution integration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'secret_operator') then
    create role secret_operator nologin noinherit;
  end if;
end
$$;

grant secret_operator to authenticator;
grant usage on schema public to secret_operator;

-- ---------------------------------------------------------------------------
-- The reference
-- ---------------------------------------------------------------------------

create table public.secret_references (
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  id               uuid        not null default gen_random_uuid(),

  -- What a consumer asks for, written as an environment name because that is what it becomes.
  -- The prefixes are refused because each already means something to the runtime that would one
  -- day receive it: a `NEXT_PUBLIC_` value is compiled into a browser bundle.
  key              text        not null
                               check (key ~ '^[A-Z][A-Z0-9_]{0,63}$'
                                      and key !~ '^(NEXT_PUBLIC_|GOLD_|GILDOPS_|SUPABASE_|VERCEL_)'),
  label            text        not null check (length(btrim(label)) between 1 and 80),
  purpose          text        not null default '' check (length(purpose) <= 300),
  status           text        not null default 'active' check (status in ('active', 'disabled')),

  -- Vault's own row. Selectable by nobody, returned by nothing (D44, D54).
  secret_id        uuid        not null,

  created_by       uuid        not null references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  rotated_at       timestamptz,
  -- Written by the one machine door that decrypts, so "used" is something that happened rather than
  -- a label somebody set. Null means no consumer has ever asked for it.
  last_resolved_at timestamptz,

  primary key (organization_id, id),
  unique (organization_id, key)
);

comment on table public.secret_references is
  'A private value a business supplied for GildOps to use. The value is in Vault; this row is its name, purpose and state. Written only by the doors below, read back as plaintext only by secret_operator.';
comment on column public.secret_references.secret_id is
  'Vault''s own row. In no column grant; a vault reference is exactly as sensitive as what it points to.';

alter table public.secret_references enable row level security;
alter table public.secret_references force  row level security;

-- Seeing that a secret exists is for whoever may manage secrets. A member who may not has no more
-- reason to learn the names of a business's credentials than to read them.
create policy secret_references_select on public.secret_references
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'secret.manage')
  );

-- Every column but `secret_id`, by name. No insert, update or delete grant to any role.
grant select (organization_id, id, key, label, purpose, status, created_by, created_at, updated_at, rotated_at, last_resolved_at)
  on public.secret_references to authenticated;

-- A cascade from a deleted organization, or any other route to a deleted row, must not leave the
-- value behind in Vault.
create function app.drop_secret_reference_value()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$fn$;

revoke all on function app.drop_secret_reference_value() from public;

create trigger secret_references_drop_value
  after delete on public.secret_references
  for each row execute function app.drop_secret_reference_value();

-- ---------------------------------------------------------------------------
-- The doors a person uses. None returns a value, and none can.
-- ---------------------------------------------------------------------------

-- The audit fact. Names the secret and what it was for, never what it held.
create function app.record_secret_event(
  p_organization_id uuid,
  p_actor           uuid,
  p_secret_id       uuid,
  p_action          text,
  p_key             text,
  p_label           text,
  p_purpose         text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_organization_id, p_actor, 'secret', p_secret_id, p_action,
    jsonb_build_object('key', p_key, 'label', p_label, 'purpose', p_purpose)
  );
$fn$;

revoke all on function app.record_secret_event(uuid, uuid, uuid, text, text, text, text) from public;

create function public.create_secret_reference(
  p_organization_id uuid,
  p_key             text,
  p_label           text,
  p_purpose         text,
  p_value           text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid;
  v_id       uuid := gen_random_uuid();
  v_secret   uuid;
  v_label    text := btrim(coalesce(p_label, ''));
  v_purpose  text := btrim(coalesce(p_purpose, ''));
begin
  v_actor := app.require_capability(p_organization_id, 'secret.manage');

  if btrim(coalesce(p_value, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;
  if length(p_value) > 8192 then
    raise exception 'a secret is at most 8192 characters' using errcode = '22023';
  end if;

  -- The vault row is named by the reference's own id, which is unique platform-wide, so two
  -- businesses can hold the same key without colliding in Vault.
  v_secret := vault.create_secret(p_value, 'secret_reference:' || v_id::text,
                                  'Secret reference ' || v_id::text);

  insert into public.secret_references
    (organization_id, id, key, label, purpose, secret_id, created_by)
  values
    (p_organization_id, v_id, p_key, v_label, v_purpose, v_secret, v_actor);

  perform app.record_secret_event(p_organization_id, v_actor, v_id, 'secret.created', p_key, v_label, v_purpose);
  return v_id;
end;
$fn$;

comment on function public.create_secret_reference(uuid, text, text, text, text) is
  'Stores a business''s private value in Vault and names it. Needs secret.manage. Returns the reference''s id and never the value.';

revoke all on function public.create_secret_reference(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_secret_reference(uuid, text, text, text, text) to authenticated;

-- Replaces the value in the same Vault row. A rotation is the one thing that can change what a
-- consumer receives, so it is its own event.
create function public.rotate_secret_reference(
  p_organization_id uuid,
  p_secret_id       uuid,
  p_value           text,
  p_label           text default null,
  p_purpose         text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_row   public.secret_references;
begin
  v_actor := app.require_capability(p_organization_id, 'secret.manage');

  if btrim(coalesce(p_value, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;
  if length(p_value) > 8192 then
    raise exception 'a secret is at most 8192 characters' using errcode = '22023';
  end if;

  -- Both halves of the key, so another business's id finds nothing rather than something.
  select * into v_row from public.secret_references
   where organization_id = p_organization_id and id = p_secret_id
   for update;
  if not found then
    raise exception 'no such secret for that organization' using errcode = '22023';
  end if;

  perform vault.update_secret(v_row.secret_id, p_value);

  update public.secret_references
     set label      = coalesce(nullif(btrim(p_label), ''), label),
         purpose    = coalesce(btrim(p_purpose), purpose),
         rotated_at = now(),
         updated_at = now()
   where organization_id = p_organization_id and id = p_secret_id
   returning * into v_row;

  perform app.record_secret_event(p_organization_id, v_actor, p_secret_id, 'secret.rotated', v_row.key, v_row.label, v_row.purpose);
end;
$fn$;

comment on function public.rotate_secret_reference(uuid, uuid, text, text, text) is
  'Replaces a business''s stored value. Needs secret.manage. The old value is overwritten in place and is not recoverable.';

revoke all on function public.rotate_secret_reference(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.rotate_secret_reference(uuid, uuid, text, text, text) to authenticated;

create function public.set_secret_reference_status(
  p_organization_id uuid,
  p_secret_id       uuid,
  p_status          text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_row   public.secret_references;
begin
  v_actor := app.require_capability(p_organization_id, 'secret.manage');

  if p_status not in ('active', 'disabled') then
    raise exception 'a secret is active or disabled' using errcode = '22023';
  end if;

  update public.secret_references
     set status = p_status, updated_at = now()
   where organization_id = p_organization_id and id = p_secret_id and status <> p_status
   returning * into v_row;

  -- Already in that state, or not this business's: nothing happened, so nothing is recorded.
  if not found then
    if not exists (select 1 from public.secret_references where organization_id = p_organization_id and id = p_secret_id) then
      raise exception 'no such secret for that organization' using errcode = '22023';
    end if;
    return;
  end if;

  perform app.record_secret_event(
    p_organization_id, v_actor, p_secret_id,
    case p_status when 'disabled' then 'secret.disabled' else 'secret.enabled' end,
    v_row.key, v_row.label, v_row.purpose
  );
end;
$fn$;

comment on function public.set_secret_reference_status(uuid, uuid, text) is
  'Disables or re-enables a stored value without destroying it. A disabled value is refused by the machine door, so whatever depends on it stops being ready.';

revoke all on function public.set_secret_reference_status(uuid, uuid, text) from public, anon;
grant execute on function public.set_secret_reference_status(uuid, uuid, text) to authenticated;

create function public.delete_secret_reference(p_organization_id uuid, p_secret_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_row   public.secret_references;
begin
  v_actor := app.require_capability(p_organization_id, 'secret.manage');

  -- The Vault row goes with it, in the delete trigger.
  delete from public.secret_references
   where organization_id = p_organization_id and id = p_secret_id
   returning * into v_row;
  if not found then
    raise exception 'no such secret for that organization' using errcode = '22023';
  end if;

  perform app.record_secret_event(p_organization_id, v_actor, p_secret_id, 'secret.deleted', v_row.key, v_row.label, v_row.purpose);
end;
$fn$;

comment on function public.delete_secret_reference(uuid, uuid) is
  'Removes a stored value and its Vault row for good. Needs secret.manage.';

revoke all on function public.delete_secret_reference(uuid, uuid) from public, anon;
grant execute on function public.delete_secret_reference(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The one door that decrypts
-- ---------------------------------------------------------------------------

-- Asked by the runtime that needs *this* value for *this* business, by the name the value was
-- stored under. Not "all of an organization's secrets" and not by Vault id. A disabled or deleted
-- value answers null, so a consumer treats it as missing rather than stale.
create function public.resolve_secret_reference(p_organization_id uuid, p_key text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_secret uuid;
  v_value  text;
begin
  select r.secret_id into v_secret
    from public.secret_references r
   where r.organization_id = p_organization_id and r.key = p_key and r.status = 'active';
  if v_secret is null then
    return null;
  end if;

  select d.decrypted_secret into v_value from vault.decrypted_secrets d where d.id = v_secret;

  update public.secret_references
     set last_resolved_at = now()
   where organization_id = p_organization_id and key = p_key;

  return v_value;
end;
$fn$;

comment on function public.resolve_secret_reference(uuid, text) is
  'A business''s stored value, decrypted, by the name it was stored under; null when absent or disabled. Executable by secret_operator alone, which only apps/api wears. The only place in this repository a Secret Reference is read.';

revoke all on function public.resolve_secret_reference(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_secret_reference(uuid, text) to secret_operator;
