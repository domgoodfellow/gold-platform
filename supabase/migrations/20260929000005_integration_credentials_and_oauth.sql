-- Using a tenant's own OAuth credential — the second reader of a secret in this repository (D56).
--
-- `store_integration_secret` (20260914000001) lets a business's admin *write* a credential and
-- returns nothing. Refreshing a token, asking Google who the account is and listing what it can
-- reach all need to *read* one, and the rule from D44 stands: nothing signed in may select a
-- secret back out — not the tenant whose account it is, not staff, not the browser. So the reader
-- is a machine role, `integration_operator`, that only `apps/api` can wear, and only after it has
-- proved through the caller's own token that the human asking may manage integrations there.
--
-- **The role holds no table grant and exactly five executes.** Read a credential, store one,
-- record the health of a connection, replace what a connection can reach, clear a credential.
-- It is the fifth role on `SUPABASE_JWT_SECRET`'s legacy path; `app/core/db.py` says not to widen
-- that path, and this widens it by one, narrowly and on record, retired by the same migration the
-- other four wait on.
--
-- **`last_error` is the provider's own words**, visible to the business that owns the
-- connection, because a person cannot reconnect what they cannot see is broken. It never holds a
-- token: the runtime that writes it never puts a credential-adjacent value in a message.

insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000a5')
on conflict (id) do nothing;

-- 00000000-0000-4000-8000-0000000000a5 is the integration-credentials integration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'integration_operator') then
    create role integration_operator nologin noinherit;
  end if;
end
$$;

grant integration_operator to authenticator;
grant usage on schema public to integration_operator;

alter table public.integration_connections
  add column last_error text check (last_error is null or length(last_error) <= 500);

comment on column public.integration_connections.last_error is
  'What the provider said the last time this connection failed, in its own words. Written only by integration_operator; never a credential.';

-- **A correction to 20260914000001, which said `secret_id` was withheld from every grant and was
-- not.** It granted `select` on the whole table, so a business's own session could read the Vault
-- pointer. A pointer is not the secret, but D44 treats it as exactly as sensitive as what it points
-- to, and "withheld from every grant" is the claim this file relies on. Re-granted by column: every
-- column but `secret_id`. Every reader in this repository names its columns, so none breaks.
revoke select on public.integration_connections from authenticated;
grant select (id, organization_id, connector_key, account_label, status, scopes, connected_by,
              last_verified_at, created_at, updated_at, last_error)
  on public.integration_connections to authenticated;

-- A discovered resource is the same thing however often it is discovered.
create unique index integration_resources_external_unique
  on public.integration_resources (organization_id, connection_id, resource_type, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- What the caller's own token can prove, so the runtime never has to guess
-- ---------------------------------------------------------------------------

-- Plain, not SECURITY DEFINER: it answers under the caller's own rights, which is the point.
create function public.can_manage_integrations(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_organization_id in (select app.current_tenant_ids())
     and app.has_capability(p_organization_id, 'integration.manage');
$fn$;

revoke all on function public.can_manage_integrations(uuid) from public, anon;
grant execute on function public.can_manage_integrations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The five doors the machine role holds
-- ---------------------------------------------------------------------------

-- The only function anywhere that returns a tenant's decrypted credential. `authenticated` is
-- refused by name.
create function public.read_integration_credential(p_connection_id uuid)
returns table (organization_id uuid, connector_key text, status text, secret text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.organization_id, c.connector_key, c.status,
         (select d.decrypted_secret from vault.decrypted_secrets d where d.id = c.secret_id)
    from public.integration_connections c
   where c.id = p_connection_id
     and c.status <> 'disconnected'
     and c.secret_id is not null;
$fn$;

comment on function public.read_integration_credential(uuid) is
  'Returns a connection''s decrypted credential to integration_operator and to nobody else. Granted to no signed-in role (D56).';

revoke all on function public.read_integration_credential(uuid) from public, anon, authenticated;
grant execute on function public.read_integration_credential(uuid) to integration_operator;

-- Writes or rotates. Returns nothing: not the secret, not the vault row's own id.
create function public.store_integration_credential(p_connection_id uuid, p_secret text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_existing uuid;
begin
  if btrim(coalesce(p_secret, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;

  select secret_id into v_existing from public.integration_connections where id = p_connection_id;
  if not found then
    raise exception 'no such connection' using errcode = '22023';
  end if;

  if v_existing is null then
    update public.integration_connections
       set secret_id = vault.create_secret(p_secret, p_connection_id::text,
                         'OAuth credential for integration_connections.' || p_connection_id::text),
           updated_at = now()
     where id = p_connection_id;
  else
    perform vault.update_secret(v_existing, p_secret);
  end if;
end;
$fn$;

revoke all on function public.store_integration_credential(uuid, text) from public, anon, authenticated;
grant execute on function public.store_integration_credential(uuid, text) to integration_operator;

-- Recorded by the runtime that actually asked the provider, so a business cannot mark its own
-- connection healthy from a browser.
create function public.record_integration_health(
  p_connection_id uuid,
  p_ok            boolean,
  p_error         text default null,
  p_account_label text default null,
  p_scopes        text[] default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  update public.integration_connections
     set status           = case when p_ok then 'active' else 'needs_attention' end,
         last_error       = case when p_ok then null else left(coalesce(p_error, 'the connection failed'), 500) end,
         last_verified_at = case when p_ok then now() else last_verified_at end,
         account_label    = case when p_ok and nullif(btrim(coalesce(p_account_label, '')), '') is not null
                                 then left(btrim(p_account_label), 200) else account_label end,
         scopes           = case when p_ok and p_scopes is not null then p_scopes else scopes end,
         updated_at       = now()
   where id = p_connection_id
     and status <> 'disconnected';

  if not found then
    raise exception 'no such live connection' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.record_integration_health(uuid, boolean, text, text, text[]) from public, anon, authenticated;
grant execute on function public.record_integration_health(uuid, boolean, text, text, text[]) to integration_operator;

-- What a connection can reach, as the provider listed it just now. An API-reached resource the
-- provider no longer lists is disabled, never deleted: an import already run must go on naming
-- where it came from. A resource GOLD holds bytes for (`storage_path`) is never touched.
create function public.replace_integration_resources(p_connection_id uuid, p_resources jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_item jsonb;
begin
  if jsonb_typeof(coalesce(p_resources, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'resources must be a JSON array' using errcode = '22023';
  end if;

  select organization_id into v_org from public.integration_connections where id = p_connection_id;
  if not found then
    raise exception 'no such connection' using errcode = '22023';
  end if;

  update public.integration_resources
     set status = 'disabled', updated_at = now()
   where connection_id = p_connection_id and storage_path is null and external_id is not null;

  for v_item in select * from jsonb_array_elements(coalesce(p_resources, '[]'::jsonb)) loop
    insert into public.integration_resources (organization_id, connection_id, resource_type, external_id, display_name, metadata)
    values (v_org, p_connection_id, v_item->>'resource_type', v_item->>'external_id',
            left(coalesce(nullif(btrim(v_item->>'display_name'), ''), v_item->>'external_id'), 200),
            coalesce(v_item->'metadata', '{}'::jsonb))
    on conflict (organization_id, connection_id, resource_type, external_id) where external_id is not null
    do update set display_name = excluded.display_name, metadata = excluded.metadata,
                  status = 'active', updated_at = now();
  end loop;
end;
$fn$;

revoke all on function public.replace_integration_resources(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_integration_resources(uuid, jsonb) to integration_operator;

-- Disconnecting removes the credential itself. The rows an import created are not touched.
create function public.clear_integration_credential(p_connection_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_secret uuid;
begin
  select secret_id into v_secret from public.integration_connections where id = p_connection_id;
  if not found then
    raise exception 'no such connection' using errcode = '22023';
  end if;

  update public.integration_connections set secret_id = null, updated_at = now() where id = p_connection_id;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$fn$;

revoke all on function public.clear_integration_credential(uuid) from public, anon, authenticated;
grant execute on function public.clear_integration_credential(uuid) to integration_operator;
