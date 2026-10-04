-- An email address a business speaks as: `hello@acme.ca`, not `acme.ca`.
--
-- **What was missing.** A verified sending domain (`organization_provider_resources`, type
-- `resend_domain`) says the provider will let addresses beneath a name send. It is not an address,
-- and it is not a mailbox. Nothing could say *this business sends as `hello@acme.ca`*, so nothing
-- could say what a conversation was spoken through, which a unified Inbox needs before it can
-- exist. This is the organization-facing identity for email, the way `phone_numbers` already is
-- for telephone numbers (and is not replaced by this: a phone number and an email address share
-- no columns worth a generic table, so there is no `communication_identities`).
--
-- **Three ways an address can be ours, one vocabulary (`ownership`).**
--   customer_domain   -- `hello@acme.ca`, beneath a sending domain the business proved. Send-only:
--                        nothing in this repository receives mail, so claiming otherwise would be
--                        a mailbox that is not one.
--   gildops_managed   -- an address beneath a domain GildOps itself operates. Reserved: no managed
--                        domain exists yet, so no writer exists and a tenant cannot create one
--                        (otherwise a business could claim any address at a domain it does not own).
--   connected_mailbox -- an address backed by a mailbox the business connected (a workspace
--                        suite). Reserved the same way: it points at the connection that backs it,
--                        and the connector that writes it arrives with mailbox sync.
--
-- **Readiness is not stored here.** An address on a customer domain is exactly as ready as the
-- provider resource beneath it, and a copy on this row would disagree the day the domain fails a
-- recheck. The row holds the reference; `lib/domain/email/identities.ts` derives the word.
--
-- **Sender and mailbox are capabilities, not kinds.** `can_send` and `can_receive` compose without
-- a third state for "both"; a mailbox is an identity that can receive.

create table public.email_identities (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  address         text        not null
                               check (address = lower(address) and address ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  display_name    text        null check (display_name is null or length(btrim(display_name)) between 1 and 120),

  can_send        boolean     not null default true,
  can_receive     boolean     not null default false,

  ownership       text        not null check (ownership in ('gildops_managed', 'customer_domain', 'connected_mailbox')),

  -- The sending domain this address sends beneath, when it is a customer's own. Composite and
  -- leading with the organization (I2/I18): another business's domain cannot be named here, by any
  -- writer. SET NULL on the resource column alone, so releasing a domain leaves the address and
  -- its history in place and simply not ready, rather than deleting what a conversation points at.
  sending_domain_resource_id uuid null,
  -- The mailbox connection that backs a connected mailbox.
  integration_connection_id  uuid null,

  status          text        not null default 'active' check (status in ('active', 'disabled')),

  created_by      uuid        null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, id),
  -- An address is one identity per business. Leads with the organization (I2): two businesses may
  -- each hold a `support@` at their own domains, and the unique key says nothing about each other.
  unique (organization_id, address),

  foreign key (organization_id, sending_domain_resource_id)
    references public.organization_provider_resources (organization_id, id) on delete set null (sending_domain_resource_id),
  foreign key (organization_id, integration_connection_id)
    references public.integration_connections (organization_id, id),

  constraint email_identities_does_something check (can_send or can_receive),
  -- Nothing here receives mail on a customer's own domain, so that identity cannot claim to.
  constraint email_identities_customer_domain_is_send_only check (ownership <> 'customer_domain' or not can_receive),
  -- A mailbox is the thing that receives, and the thing that backs it is its connection.
  constraint email_identities_connected_mailbox_has_a_connection
    check ((ownership = 'connected_mailbox') = (integration_connection_id is not null)),
  constraint email_identities_connected_mailbox_receives check (ownership <> 'connected_mailbox' or can_receive),
  -- Only a customer's own domain has a sending-domain resource to name.
  constraint email_identities_only_customer_domain_names_a_domain
    check (ownership = 'customer_domain' or sending_domain_resource_id is null)
);

comment on table public.email_identities is
  'An email address this business speaks as (hello@acme.ca) — distinct from the sending domain it may be beneath and from a mailbox. Readiness is derived from the provider resource, never stored here.';
comment on column public.email_identities.can_receive is
  'Whether inbound mail for this address is read by this platform. False for every customer_domain identity: no inbound path exists, and claiming one would be a fake mailbox.';

create index email_identities_org_idx on public.email_identities (organization_id, status);

-- What a database must say that a column type cannot: an address on a customer domain sits beneath
-- exactly that domain, and the resource it names is a sending domain. Checked here so no caller —
-- a form, an import, a script — can ever write a `hello@other.com` under `acme.ca`'s verification.
create function app.check_email_identity() returns trigger
language plpgsql set search_path = '' as $fn$
declare
  v_type text;
  v_domain text;
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.address is distinct from old.address or new.ownership is distinct from old.ownership then
      raise exception 'an email identity''s address and ownership do not change' using errcode = '23514';
    end if;
  end if;

  if new.ownership = 'customer_domain' then
    if new.sending_domain_resource_id is null then
      -- Only a released domain may leave this null (the foreign key's SET NULL), never a write.
      if tg_op = 'INSERT' then
        raise exception 'an address on a customer domain names that sending domain' using errcode = '23514';
      end if;
      return new;
    end if;

    select r.resource_type, r.external_id into v_type, v_domain
      from public.organization_provider_resources r
     where r.organization_id = new.organization_id and r.id = new.sending_domain_resource_id;

    if v_type is distinct from 'resend_domain' then
      raise exception 'that resource is not a sending domain' using errcode = '23514';
    end if;
    if split_part(new.address, '@', 2) <> v_domain then
      raise exception 'that address is not beneath the sending domain it names' using errcode = '23514';
    end if;
  end if;

  return new;
end $fn$;

revoke all on function app.check_email_identity() from public;

create trigger email_identities_check
  before insert or update on public.email_identities
  for each row execute function app.check_email_identity();

alter table public.email_identities enable row level security;
alter table public.email_identities force row level security;

create policy email_identities_select on public.email_identities
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- A business names an address on a domain it has already proved, and only that: the other two
-- ownership modes have no tenant writer (see the header), so they are refused here by name.
create policy email_identities_insert on public.email_identities
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
    and ownership = 'customer_domain'
    and not can_receive
    and created_by = (select auth.uid())
  );

create policy email_identities_update on public.email_identities
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'organization.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'organization.manage'));

-- By column, because a table-wide grant is a promise about every column the table will ever have.
-- The address, its ownership and its references are the identity itself and never change after.
grant select on public.email_identities to authenticated;
grant insert (organization_id, address, display_name, can_send, ownership, sending_domain_resource_id, created_by)
  on public.email_identities to authenticated;
grant update (display_name, can_send, status) on public.email_identities to authenticated;
