-- Email is a channel of the one Message, not a second messaging system.
--
-- **What this adds, and what it refuses to add.** `messages` already is the canonical record of
-- something said in a conversation, and `conversations.channel` already says which channel it ran
-- on. Email therefore reuses both: no `email_messages`, no `email_conversations`. What only an
-- email has (a subject, an RFC Message-ID, the headers that thread a reply, an HTML body) lives in
-- `email_message_details`, one row per email message, so an SMS row carries none of it. What
-- happened to a message over time lives in `message_events`, append-only, because a status column
-- alone cannot answer "when did it bounce, and was that webhook delivered twice".
--
-- **Three different doors, because three different trusts.**
--   * a business's person sends: `queue_outbound_email`, a signed-in command that decides every
--     authoritative fact itself (which address, which recipient, whether the address may send,
--     which thread). The browser names an identity and a recipient and nothing else.
--   * apps/api, after proving the caller may send this message, tells the database what the
--     provider answered: `claim_email_for_send` / `record_email_send_result`, `provider_operator`
--     only. A signed-in role can no longer write `status`, `external_id` or a delivery time on an
--     email message by any path, so a client cannot mark its own mail delivered.
--   * the provider calls in: `record_email_event` and `record_inbound_email`, executable by
--     `tenant_email_webhook` alone, which holds no table grant. The organization is derived from
--     what the provider names (its own message id; the address mail was sent to), never accepted.

-- ---------------------------------------------------------------------------
-- Vocabulary: additive supersets of the SMS vocabulary
-- ---------------------------------------------------------------------------
alter table public.messages drop constraint messages_status_check;
alter table public.messages add constraint messages_status_check check (status in
  ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'rejected', 'bounced'));

alter table public.messages drop constraint messages_requested_transport_check;
alter table public.messages add constraint messages_requested_transport_check
  check (requested_transport in ('sms', 'mms', 'rcs', 'email'));
alter table public.messages drop constraint messages_transport_check;
alter table public.messages add constraint messages_transport_check
  check (transport is null or transport in ('sms', 'mms', 'rcs', 'email'));

-- A text is bounded by what a carrier will carry; an email body is a document. The two limits are
-- one rule keyed on the transport so neither silently becomes the other's.
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check
  check (length(body) <= case when requested_transport = 'email' then 200000 else 1600 end);

-- A signed-in session may no longer create or change an email message row directly. SMS keeps its
-- existing policies exactly (the sender's own session writes its own just-sent row); email goes
-- through the doors above, so `status`, `external_id` and `sent_at` on an email message are only
-- ever the provider's word.
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'message.send')
    and direction = 'outbound'
    and created_by = (select auth.uid())
    and requested_transport <> 'email'
  );

drop policy messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'message.send')
    and created_by = (select auth.uid())
    and requested_transport <> 'email'
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'message.send')
    and created_by = (select auth.uid())
    and requested_transport <> 'email'
  );

-- ---------------------------------------------------------------------------
-- Conversation: what an email thread is about and who is on the other end
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column subject text null check (subject is null or length(subject) <= 998),
  add column external_email text null
    check (external_email is null or (external_email = lower(external_email) and external_email ~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$'));

-- The conversation, not the provider, is the thread: an email thread has one external participant
-- for now (more arrive with the inbox work) and the subject it was started under.
alter table public.conversations drop constraint conversations_channel_addressing;
alter table public.conversations add constraint conversations_channel_addressing check (
  (channel = 'sms'   and phone_number_id is not null and external_number is not null
                     and email_identity_id is null and external_email is null)
  or
  (channel = 'email' and phone_number_id is null and external_number is null
                     and email_identity_id is not null and external_email is not null)
) not valid;
-- NOT VALID: an email conversation could not be created by any signed-in caller before this (no
-- writer existed), so the only rows that can predate `external_email` are fixtures from a database
-- that exercised the previous constraint by hand. The check binds every row from here on; it is not
-- retro-fitted onto rows that have no address to give it, and none is deleted to make it so.

create index conversations_org_email_idx on public.conversations (organization_id, email_identity_id, external_email)
  where channel = 'email';

-- ---------------------------------------------------------------------------
-- Receiving is the business's own statement about an address on its own domain
-- ---------------------------------------------------------------------------
-- Dropped: it forbade any customer-domain address from receiving, which was true while nothing read
-- mail. Inbound now exists, and whether a domain's mail is pointed here is a fact about that
-- domain's own DNS which a business states, so it may set `can_receive` on its own address.
-- Provisioning the receiving records is the provider-provisioning concern and is not done here.
alter table public.email_identities drop constraint email_identities_customer_domain_is_send_only;
grant update (can_receive) on public.email_identities to authenticated;
comment on column public.email_identities.can_receive is
  'Whether inbound mail for this address is read here. A business states it for an address on its own domain once the domain''s mail records point at GildOps; an inbound message is accepted only for an active address that says so, beneath a verified domain.';

-- ---------------------------------------------------------------------------
-- app helpers: pure, immutable, and the one place each rule is written
-- ---------------------------------------------------------------------------

-- Forward-only, with every failure outranking every success: a late `sent` cannot make a delivered
-- message merely sent, and a message that bounced is not delivered by a later callback. A bounce
-- *after* delivery is real (an asynchronous rejection) and is allowed, because failure outranks
-- delivery. Engagement (opened, clicked) is not a status at all and never reaches this.
create function app.message_status_rank(p_status text) returns integer
language sql immutable set search_path = '' as $$
  select case p_status
    when 'queued' then 0 when 'sending' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4
    when 'failed' then 10 when 'rejected' then 10 when 'bounced' then 10 when 'undelivered' then 10
    else 0 end
$$;
revoke all on function app.message_status_rank(text) from public;

create function app.normalize_message_id(p_value text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(btrim(p_value), '') is null then null
              when btrim(p_value) ~ '^<.+>$' then btrim(p_value)
              else '<' || btrim(p_value) || '>' end
$$;
revoke all on function app.normalize_message_id(text) from public;

-- For display and search only. Never used to decide which conversation a message belongs to.
create function app.normalize_subject(p_value text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p_value, ''), '^(\s*(re|fwd?|fw)\s*:\s*)+', '', 'i')), '')
$$;
revoke all on function app.normalize_subject(text) from public;

-- ---------------------------------------------------------------------------
-- email_message_details: what only an email has
-- ---------------------------------------------------------------------------
create table public.email_message_details (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id      uuid not null,
  subject         text not null default '' check (length(subject) <= 998),
  from_address    text not null,
  from_name       text null,
  to_addresses    text[] not null default '{}',
  cc_addresses    text[] not null default '{}',
  html_body       text null check (html_body is null or length(html_body) <= 1000000),
  -- The RFC Message-ID, only once the provider has said what it is (outbound) or the mail itself
  -- carried it (inbound). Never a value this platform made up and assumed the provider kept.
  rfc_message_id  text null,
  in_reply_to     text null,
  reference_ids   text[] not null default '{}',
  -- A copy of what the authentication checks said, as the provider reported it. Information only.
  authentication  jsonb null,

  primary key (organization_id, message_id),
  foreign key (organization_id, message_id) references public.messages (organization_id, id) on delete cascade
);

-- Leads with the organization (I2): the thread lookup below is `where organization_id = ... and
-- rfc_message_id = ...`, and one business's Message-ID must never find another's message.
create unique index email_message_details_rfc_message_id_idx
  on public.email_message_details (organization_id, rfc_message_id) where rfc_message_id is not null;

alter table public.email_message_details enable row level security;
alter table public.email_message_details force row level security;
create policy email_message_details_select on public.email_message_details
  for select to authenticated using (organization_id in (select app.current_tenant_ids()));
grant select on public.email_message_details to authenticated;

-- ---------------------------------------------------------------------------
-- message_events: what happened to a message, append-only
-- ---------------------------------------------------------------------------
create table public.message_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  message_id        uuid not null,
  event_type        text not null check (event_type in
    ('queued', 'accepted', 'sent', 'delivered', 'delayed', 'bounced', 'failed', 'rejected', 'complained',
     'opened', 'clicked', 'received')),
  -- What this event did to the canonical status, or null when it only adds to the history
  -- (a delay, an open, a complaint). The history keeps the event either way.
  status_after      text null,
  -- The provider's own identity for one callback, the retry guard: a delivery attempted three times
  -- is one row. Null only for events this platform itself raised.
  provider_event_id text null,
  -- When the provider says it happened, kept apart from `occurred_at` (when this platform heard),
  -- so a delayed event never reads as newer than one that already landed.
  provider_event_at timestamptz null,
  occurred_at       timestamptz not null default now(),
  detail            text null check (detail is null or length(detail) <= 500),
  payload           jsonb not null default '{}'::jsonb,

  foreign key (organization_id, message_id) references public.messages (organization_id, id) on delete cascade
);

create unique index message_events_provider_event_idx
  on public.message_events (organization_id, provider_event_id) where provider_event_id is not null;
create index message_events_message_idx
  on public.message_events (organization_id, message_id, coalesce(provider_event_at, occurred_at));

alter table public.message_events enable row level security;
alter table public.message_events force row level security;
create policy message_events_select on public.message_events
  for select to authenticated using (organization_id in (select app.current_tenant_ids()));
grant select on public.message_events to authenticated;

-- ---------------------------------------------------------------------------
-- message_attachments: files that belong to one message
-- ---------------------------------------------------------------------------
create table public.message_attachments (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  message_id             uuid not null,
  filename               text not null check (length(btrim(filename)) between 1 and 255),
  content_type           text not null check (length(btrim(content_type)) between 1 and 255),
  size_bytes             bigint null check (size_bytes is null or size_bytes >= 0),
  content_disposition    text null,
  content_id             text null,
  -- Where the bytes durably are. Never a provider's temporary download address: those expire, so
  -- they are fetched once, stored here, and forgotten.
  storage_path           text null check (storage_path is null or length(storage_path) between 1 and 1024),
  storage_state          text not null default 'pending' check (storage_state in ('pending', 'stored', 'rejected')),
  rejection_reason       text null check (rejection_reason is null or length(rejection_reason) <= 300),
  provider_attachment_id text null,
  created_at             timestamptz not null default now(),

  foreign key (organization_id, message_id) references public.messages (organization_id, id) on delete cascade,
  constraint message_attachments_stored_has_a_path check (storage_state <> 'stored' or storage_path is not null),
  -- An attachment's bytes live under its own organization's folder or nowhere (belt and braces with
  -- the storage policies): the first path segment is the organization id.
  constraint message_attachments_path_is_own check (storage_path is null or storage_path like organization_id::text || '/%')
);
create unique index message_attachments_provider_idx
  on public.message_attachments (organization_id, message_id, provider_attachment_id) where provider_attachment_id is not null;
create index message_attachments_message_idx on public.message_attachments (organization_id, message_id);

alter table public.message_attachments enable row level security;
alter table public.message_attachments force row level security;
create policy message_attachments_select on public.message_attachments
  for select to authenticated using (organization_id in (select app.current_tenant_ids()));
grant select on public.message_attachments to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, organization-prefixed, written by the sender's own JWT (outbound)
-- or by the inbound webhook role (inbound), read by the owning organization only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('communications', 'communications', false, 10485760)
on conflict (id) do nothing;

create policy communications_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'communications'
         and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t));

-- Outbound uploads sit under `{organization}/outbound/...` and need the authority to send: a person
-- who may not send may not park files for a send.
create policy communications_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'communications'
              and (storage.foldername(name))[2] = 'outbound'
              and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
              and app.has_capability(((storage.foldername(name))[1])::uuid, 'message.send'));

-- A person may withdraw an upload of their own that no message ever used.
create policy communications_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'communications'
         and (storage.foldername(name))[2] = 'outbound'
         and owner = (select auth.uid())
         and not exists (select 1 from public.message_attachments a where a.storage_path = name));

-- ---------------------------------------------------------------------------
-- The inbound webhook's own machine role: no table grant, two doors
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role) values ('00000000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated')
  on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'tenant_email_webhook') then
    create role tenant_email_webhook nologin noinherit;
  end if;
end $$;
grant tenant_email_webhook to authenticator;
grant usage on schema public to tenant_email_webhook;
grant usage on schema storage to tenant_email_webhook;

-- It stores a received attachment under `{organization}/inbound/...` and nothing else: it has no
-- select, so it cannot read a file back, and no update or delete.
grant insert on storage.objects to tenant_email_webhook;
create policy communications_objects_inbound_insert on storage.objects
  for insert to tenant_email_webhook
  with check (bucket_id = 'communications' and (storage.foldername(name))[2] = 'inbound');

-- ---------------------------------------------------------------------------
-- Usage: one `email_send` per message the provider accepted, idempotent by the message
-- ---------------------------------------------------------------------------
create function app.charge_for_email(p_message_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_message public.messages; v_feature uuid; v_binding uuid;
begin
  select m.* into v_message from public.messages m where m.id = p_message_id;
  if not found or v_message.direction <> 'outbound' or v_message.requested_transport <> 'email' then return; end if;

  select f.id into v_feature
    from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
   where m.key = 'email' and f.key = 'sending';

  -- GildOps' own provider account serves tenant email, so this is fulfilled through the platform
  -- account and names no tenant binding. The reference makes a retried callback the same fact.
  perform app.record_usage(
    v_message.organization_id, 'email_send', 1, 'resend', now(),
    v_feature, null, null, 'email:' || v_message.id::text, format('email %s', v_message.id), 'platform_account');
end $$;
revoke all on function app.charge_for_email(uuid) from public;

-- Move a message to `p_new` only if that is forward (see message_status_rank), record it, and bill
-- the first time it reaches `sent`. Returns whether the canonical status actually changed.
create function app.advance_email_status(p_organization_id uuid, p_message_id uuid, p_new text, p_failure text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_current text;
begin
  select status into v_current from public.messages
   where organization_id = p_organization_id and id = p_message_id for update;
  if v_current is null or app.message_status_rank(p_new) <= app.message_status_rank(v_current) then
    return false;
  end if;

  update public.messages
     set status = p_new,
         failure_reason = case when app.message_status_rank(p_new) >= 10 then coalesce(p_failure, failure_reason) else failure_reason end,
         sent_at = case when p_new in ('sent', 'delivered') then coalesce(sent_at, now()) else sent_at end,
         delivered_at = case when p_new = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         transport = 'email'
   where organization_id = p_organization_id and id = p_message_id;

  if p_new in ('sent', 'delivered') then
    perform app.charge_for_email(p_message_id);
  end if;
  return true;
end $$;
revoke all on function app.advance_email_status(uuid, uuid, text, text) from public;

-- Whether this address may send right now, read from the provider resource beneath it — the same
-- answer `lib/domain/email/identities.ts` gives a screen, written once more here because this is
-- the one that decides, and a test pins the two together. Never stored on the identity.
create function app.email_identity_ready(p_organization_id uuid, p_identity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case i.ownership
             when 'customer_domain' then exists (
               select 1 from public.organization_provider_resources r
                where r.organization_id = i.organization_id and r.id = i.sending_domain_resource_id
                  and r.resource_type = 'resend_domain' and r.status = 'active')
             when 'connected_mailbox' then exists (
               select 1 from public.integration_connections c
                where c.organization_id = i.organization_id and c.id = i.integration_connection_id and c.status = 'active')
             else false end
      from public.email_identities i
     where i.organization_id = p_organization_id and i.id = p_identity_id and i.status = 'active' and i.can_send
  ), false)
$$;
revoke all on function app.email_identity_ready(uuid, uuid) from public;

-- Which conversation an inbound message belongs to, by what the mail itself says and never by who
-- sent it or what it was called. In-Reply-To first, then References nearest-ancestor first; only
-- inside this organization and only through this address, so provider metadata that merely looks
-- similar can never move a thread across a business or an identity. No match is a new conversation.
create function app.resolve_email_thread(p_organization_id uuid, p_identity_id uuid, p_in_reply_to text, p_references text[])
returns uuid language sql stable security definer set search_path = '' as $$
  with candidates as (
    select c, ord from unnest(
      array[app.normalize_message_id(p_in_reply_to)]
      || array(select app.normalize_message_id(r) from unnest(coalesce(p_references, '{}')) with ordinality t(r, n) order by n desc)
    ) with ordinality as u(c, ord)
    where c is not null
  )
  select m.conversation_id
    from candidates cd
    join public.email_message_details d on d.organization_id = p_organization_id and d.rfc_message_id = cd.c
    join public.messages m on m.organization_id = d.organization_id and m.id = d.message_id
    join public.conversations cv on cv.organization_id = m.organization_id and cv.id = m.conversation_id
   where cv.channel = 'email' and cv.email_identity_id = p_identity_id
   order by cd.ord
   limit 1
$$;
revoke all on function app.resolve_email_thread(uuid, uuid, text, text[]) from public;

-- ---------------------------------------------------------------------------
-- queue_outbound_email: the command a person's send becomes
-- ---------------------------------------------------------------------------
create function public.queue_outbound_email(
  p_organization_id  uuid,
  p_email_identity_id uuid,
  p_to               text,
  p_subject          text,
  p_text             text,
  p_html             text,
  p_conversation_id  uuid,
  p_idempotency_key  text,
  p_customer_id      uuid,
  p_attachments      jsonb
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing uuid;
  v_conv public.conversations;
  v_identity public.email_identities;
  v_to text;
  v_subject text;
  v_conv_id uuid;
  v_message_id uuid;
  v_customer uuid;
  v_in_reply_to text;
  v_refs text[];
  v_attachment jsonb;
  v_total bigint := 0;
  v_count integer := 0;
  v_size bigint;
  v_path text;
begin
  if v_actor is null then
    raise exception 'queue_outbound_email requires an authenticated caller' using errcode = '42501';
  end if;
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'message.send') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'an email send needs an idempotency key' using errcode = '22023';
  end if;

  -- The same attempt, not a second one. Checked first so a retry after any later failure returns
  -- the message already made rather than sending again.
  select id into v_existing from public.messages
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if coalesce(btrim(p_text), '') = '' and coalesce(btrim(p_html), '') = '' then
    raise exception 'an email needs something to say' using errcode = '22023';
  end if;
  if length(coalesce(p_text, '')) > 200000 or length(coalesce(p_html, '')) > 1000000 then
    raise exception 'that email is too large' using errcode = '54000';
  end if;

  -- Reply: the conversation fixes the address it speaks through and the person it speaks to, so a
  -- reply can name neither. A different `p_email_identity_id` or `p_to` is refused, never obeyed.
  if p_conversation_id is not null then
    select * into v_conv from public.conversations
     where organization_id = p_organization_id and id = p_conversation_id and channel = 'email';
    if not found then
      raise exception 'no such email conversation' using errcode = '42501';
    end if;
    if p_email_identity_id is not null and p_email_identity_id <> v_conv.email_identity_id then
      raise exception 'a reply is sent from the address the conversation is on' using errcode = '22023';
    end if;
    v_to := v_conv.external_email;
    if p_to is not null and lower(btrim(p_to)) <> v_to then
      raise exception 'a reply goes to the person the conversation is with' using errcode = '22023';
    end if;
    select * into v_identity from public.email_identities
     where organization_id = p_organization_id and id = v_conv.email_identity_id;
    v_subject := coalesce(nullif(btrim(p_subject), ''),
                          case when v_conv.subject is null then '' else 'Re: ' || v_conv.subject end);
    v_conv_id := v_conv.id;
    v_customer := v_conv.customer_id;
  else
    select * into v_identity from public.email_identities
     where organization_id = p_organization_id and id = p_email_identity_id;
    if not found then
      raise exception 'that address does not belong to this business' using errcode = '42501';
    end if;
    v_to := lower(btrim(coalesce(p_to, '')));
    v_subject := btrim(coalesce(p_subject, ''));
    if v_subject = '' then
      raise exception 'an email needs a subject' using errcode = '22023';
    end if;
  end if;

  if v_to !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$' or length(v_to) > 254 then
    raise exception 'that is not an email address' using errcode = '22023';
  end if;
  if length(v_subject) > 998 or v_subject ~ '[\r\n]' then
    raise exception 'that subject cannot be sent' using errcode = '22023';
  end if;

  -- Not ready is a state the sender can read and fix, and refusing here — before anything is
  -- written — is what keeps a message that could never leave out of the history.
  if not app.email_identity_ready(p_organization_id, v_identity.id) then
    raise exception 'that address cannot send email right now' using errcode = '55000';
  end if;

  if p_conversation_id is null then
    -- Associate a known customer only when exactly one matches the address; never create one.
    v_customer := p_customer_id;
    if v_customer is null then
      select c.id into v_customer from public.customers c
       where c.organization_id = p_organization_id and lower(c.email) = v_to
         and (select count(*) from public.customers c2 where c2.organization_id = p_organization_id and lower(c2.email) = v_to) = 1;
    end if;
    insert into public.conversations (organization_id, channel, email_identity_id, external_email, customer_id, subject, last_message_preview, unread)
      values (p_organization_id, 'email', v_identity.id, v_to, v_customer, app.normalize_subject(v_subject), left(coalesce(nullif(p_text, ''), v_subject), 280), false)
      returning id into v_conv_id;
  else
    select d.rfc_message_id into v_in_reply_to
      from public.email_message_details d join public.messages m on m.organization_id = d.organization_id and m.id = d.message_id
     where m.organization_id = p_organization_id and m.conversation_id = v_conv_id and d.rfc_message_id is not null
     order by m.created_at desc limit 1;
    select coalesce(array_agg(x.rfc_message_id order by x.created_at), '{}') into v_refs from (
      select d.rfc_message_id, m.created_at
        from public.email_message_details d join public.messages m on m.organization_id = d.organization_id and m.id = d.message_id
       where m.organization_id = p_organization_id and m.conversation_id = v_conv_id and d.rfc_message_id is not null
       order by m.created_at desc limit 20) x;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, status, body, requested_transport, idempotency_key, created_by)
    values (p_organization_id, v_conv_id, 'outbound', 'queued', coalesce(p_text, ''), 'email', p_idempotency_key, v_actor)
    returning id into v_message_id;

  insert into public.email_message_details
    (organization_id, message_id, subject, from_address, from_name, to_addresses, html_body, in_reply_to, reference_ids)
    values (p_organization_id, v_message_id, v_subject, v_identity.address, v_identity.display_name, array[v_to], nullif(p_html, ''),
            v_in_reply_to, coalesce(v_refs, '{}'));

  -- Attachments: parked by the sender's own session under its own organization's folder, and
  -- checked here to exist, to be this business's, and to fit.
  for v_attachment in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_count := v_count + 1;
    v_path := v_attachment ->> 'storage_path';
    v_size := coalesce((v_attachment ->> 'size_bytes')::bigint, 0);
    if v_count > 10 then raise exception 'an email carries at most 10 attachments' using errcode = '54000'; end if;
    if v_path is null or v_path not like p_organization_id::text || '/outbound/%' then
      raise exception 'that attachment is not this business''s' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'communications' and o.name = v_path) then
      raise exception 'that attachment was not uploaded' using errcode = '22023';
    end if;
    if v_size <= 0 or v_size > 10485760 then raise exception 'an attachment is larger than 10 MB' using errcode = '54000'; end if;
    v_total := v_total + v_size;
    if v_total > 26214400 then raise exception 'the attachments together are larger than 25 MB' using errcode = '54000'; end if;
    insert into public.message_attachments (organization_id, message_id, filename, content_type, size_bytes, storage_path, storage_state)
      values (p_organization_id, v_message_id, left(btrim(v_attachment ->> 'filename'), 255),
              coalesce(nullif(btrim(v_attachment ->> 'content_type'), ''), 'application/octet-stream'), v_size, v_path, 'stored');
  end loop;

  insert into public.message_events (organization_id, message_id, event_type, status_after, detail)
    values (p_organization_id, v_message_id, 'queued', 'queued', null);

  update public.conversations
     set last_message_at = now(), last_message_preview = left(coalesce(nullif(p_text, ''), v_subject), 280)
   where organization_id = p_organization_id and id = v_conv_id;

  return v_message_id;
end $$;
revoke all on function public.queue_outbound_email(uuid, uuid, text, text, text, text, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.queue_outbound_email(uuid, uuid, text, text, text, text, uuid, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- apps/api's doors: provider_operator only
-- ---------------------------------------------------------------------------

-- Claim a queued message for sending: queued -> sending, exactly once. Two attempts at the same
-- message (a retry, a double click upstream) cannot both proceed to the provider.
create function public.claim_email_for_send(p_organization_id uuid, p_message_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_found boolean;
begin
  update public.messages set status = 'sending'
   where organization_id = p_organization_id and id = p_message_id
     and requested_transport = 'email' and direction = 'outbound' and status = 'queued'
  returning true into v_found;
  return coalesce(v_found, false);
end $$;
revoke all on function public.claim_email_for_send(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_for_send(uuid, uuid) to provider_operator;

-- What the provider answered about one send. `accepted` is the provider taking the request (the
-- message becomes `sent`, and is billed once); `rejected` is the provider refusing it (a fact about
-- the message, not retried); `failed` is a failure that is not the provider refusing (nothing
-- could send it); `retry` puts it back to `queued` after a transient fault so the same attempt can
-- be made again. The provider-confirmed Message-ID, when known, is what a reply threads against.
create function public.record_email_send_result(
  p_organization_id uuid, p_message_id uuid, p_outcome text,
  p_external_id text default null, p_detail text default null, p_rfc_message_id text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_found boolean;
begin
  if p_outcome not in ('accepted', 'rejected', 'failed', 'retry') then
    raise exception 'unknown outcome: %', p_outcome using errcode = '22023';
  end if;

  perform 1 from public.messages
   where organization_id = p_organization_id and id = p_message_id and requested_transport = 'email' and direction = 'outbound';
  if not found then
    raise exception 'no such outbound email' using errcode = '22023';
  end if;

  if p_outcome = 'retry' then
    update public.messages set status = 'queued', failure_reason = left(p_detail, 500)
     where organization_id = p_organization_id and id = p_message_id and status = 'sending';
    return;
  end if;

  if p_outcome = 'accepted' then
    update public.messages set external_id = coalesce(external_id, p_external_id)
     where organization_id = p_organization_id and id = p_message_id;
    update public.email_message_details set rfc_message_id = coalesce(rfc_message_id, app.normalize_message_id(p_rfc_message_id))
     where organization_id = p_organization_id and message_id = p_message_id;
  end if;

  insert into public.message_events (organization_id, message_id, event_type, status_after, provider_event_id, detail)
    values (p_organization_id, p_message_id, p_outcome,
            case p_outcome when 'accepted' then 'sent' when 'rejected' then 'rejected' else 'failed' end,
            -- One result of each kind per message: recording the same answer twice is one event.
            'send:' || p_message_id::text || ':' || p_outcome, left(p_detail, 500))
    on conflict do nothing;

  perform app.advance_email_status(p_organization_id, p_message_id,
    case p_outcome when 'accepted' then 'sent' when 'rejected' then 'rejected' else 'failed' end, p_detail);
end $$;
revoke all on function public.record_email_send_result(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_email_send_result(uuid, uuid, text, text, text, text) to provider_operator;

-- ---------------------------------------------------------------------------
-- The provider's callbacks: tenant_email_webhook only
-- ---------------------------------------------------------------------------

-- One delivery event about an email this platform sent. The organization and message come from the
-- provider's own message id, which this platform recorded when it was accepted; a callback naming
-- one it never sent is not an error and writes nothing.
create function public.record_email_event(
  p_provider_message_id text, p_event_type text, p_provider_event_id text,
  p_detail text, p_payload jsonb, p_event_at timestamptz default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_message uuid; v_event uuid; v_status text; v_type text;
begin
  if p_event_type not in ('sent', 'delivered', 'delayed', 'bounced', 'failed', 'rejected', 'complained', 'opened', 'clicked') then
    raise exception 'unknown email event: %', p_event_type using errcode = '22023';
  end if;
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then
    raise exception 'a provider event needs its own id' using errcode = '22023';
  end if;

  select organization_id, id into v_org, v_message from public.messages
   where external_id = p_provider_message_id and requested_transport = 'email' and direction = 'outbound'
   limit 1;
  if v_org is null then return null; end if;

  -- Only these move the canonical status; a delay, an open, a click and a complaint are history.
  v_status := case p_event_type when 'sent' then 'sent' when 'delivered' then 'delivered'
                                when 'bounced' then 'bounced' when 'failed' then 'failed' when 'rejected' then 'rejected' end;

  insert into public.message_events (organization_id, message_id, event_type, status_after, provider_event_id, provider_event_at, detail, payload)
    values (v_org, v_message, p_event_type, v_status, p_provider_event_id, p_event_at, left(p_detail, 500), coalesce(p_payload, '{}'::jsonb))
    on conflict (organization_id, provider_event_id) where provider_event_id is not null do nothing
    returning id into v_event;
  -- A retried callback is the same fact: no second event, no second transition, no second bill.
  if v_event is null then return null; end if;

  if v_status is not null and app.advance_email_status(v_org, v_message, v_status, p_detail) then
    if v_status in ('delivered', 'bounced', 'failed', 'rejected') then
      insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (v_org, '00000000-0000-4000-8000-0000000000a7', 'message', v_message,
                case v_status when 'delivered' then 'email.delivered' else 'email.' || v_status end,
                jsonb_build_object('channel', 'email'));
    end if;
  end if;
  return v_event;
end $$;
revoke all on function public.record_email_event(text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_email_event(text, text, text, text, jsonb, timestamptz) to tenant_email_webhook;

-- A verified inbound email, persisted as canonical Communications data. The receiving address is
-- the only identifying input: the organization, the identity and the thread are all derived.
create function public.record_inbound_email(
  p_to_addresses text[], p_from_address text, p_provider_email_id text, p_provider_event_id text,
  p_rfc_message_id text, p_in_reply_to text, p_references text[], p_subject text,
  p_text text, p_html text, p_received_at timestamptz, p_authentication jsonb, p_attachments jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_identity public.email_identities;
  v_matches integer;
  v_from text := lower(btrim(coalesce(p_from_address, '')));
  v_conv uuid;
  v_message uuid;
  v_customer uuid;
  v_subject text := left(coalesce(p_subject, ''), 998);
  v_attachment jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_att uuid;
  v_existing uuid;
  v_received timestamptz := coalesce(p_received_at, now());
begin
  if p_provider_email_id is null or btrim(p_provider_email_id) = '' then
    return null;
  end if;
  if v_from !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;

  -- The receiving address, among every recipient the provider listed. Exactly one active,
  -- receiving, sendable-domain identity must match: none is not ours, and several means two
  -- businesses claim one address, which this refuses rather than guesses at.
  select count(*) into v_matches
    from public.email_identities i
   where i.address = any (select lower(btrim(a)) from unnest(coalesce(p_to_addresses, '{}')) a)
     and i.can_receive and i.status = 'active'
     and (i.ownership <> 'customer_domain' or exists (
           select 1 from public.organization_provider_resources r
            where r.organization_id = i.organization_id and r.id = i.sending_domain_resource_id
              and r.resource_type = 'resend_domain' and r.status = 'active'));
  if v_matches <> 1 then
    return null;
  end if;
  select i.* into v_identity
    from public.email_identities i
   where i.address = any (select lower(btrim(a)) from unnest(coalesce(p_to_addresses, '{}')) a)
     and i.can_receive and i.status = 'active'
     and (i.ownership <> 'customer_domain' or exists (
           select 1 from public.organization_provider_resources r
            where r.organization_id = i.organization_id and r.id = i.sending_domain_resource_id
              and r.resource_type = 'resend_domain' and r.status = 'active'));

  -- The same provider email already recorded (a retried callback): return it, change nothing.
  select m.id into v_existing from public.messages m
   where m.organization_id = v_identity.organization_id and m.external_id = p_provider_email_id;
  if found then
    return jsonb_build_object('message_id', v_existing, 'organization_id', v_identity.organization_id, 'attachments', '[]'::jsonb, 'duplicate', true);
  end if;

  -- The same RFC Message-ID already held (the provider delivered one mail under two ids): the same
  -- email, not a second one.
  select d.message_id into v_existing from public.email_message_details d
   where d.organization_id = v_identity.organization_id and d.rfc_message_id = app.normalize_message_id(p_rfc_message_id);
  if found then
    return jsonb_build_object('message_id', v_existing, 'organization_id', v_identity.organization_id, 'attachments', '[]'::jsonb, 'duplicate', true);
  end if;

  v_conv := app.resolve_email_thread(v_identity.organization_id, v_identity.id, p_in_reply_to, p_references);

  if v_conv is null then
    -- Known customer only when exactly one has this address. Never created here.
    select c.id into v_customer from public.customers c
     where c.organization_id = v_identity.organization_id and lower(c.email) = v_from
       and (select count(*) from public.customers c2 where c2.organization_id = v_identity.organization_id and lower(c2.email) = v_from) = 1;
    insert into public.conversations (organization_id, channel, email_identity_id, external_email, customer_id, subject, last_message_at, last_message_preview, unread)
      values (v_identity.organization_id, 'email', v_identity.id, v_from, v_customer, app.normalize_subject(v_subject), v_received,
              left(coalesce(nullif(p_text, ''), v_subject), 280), true)
      returning id into v_conv;
  else
    update public.conversations
       set last_message_at = greatest(last_message_at, v_received),
           last_message_preview = left(coalesce(nullif(p_text, ''), v_subject), 280), unread = true
     where organization_id = v_identity.organization_id and id = v_conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, status, body, requested_transport, transport, external_id, sent_at, delivered_at)
    values (v_identity.organization_id, v_conv, 'inbound', 'delivered', left(coalesce(p_text, ''), 200000), 'email', 'email', p_provider_email_id, v_received, v_received)
    on conflict (organization_id, external_id) do nothing
    returning id into v_message;
  if v_message is null then
    return null;
  end if;

  insert into public.email_message_details
    (organization_id, message_id, subject, from_address, to_addresses, html_body, rfc_message_id, in_reply_to, reference_ids, authentication)
    values (v_identity.organization_id, v_message, v_subject, v_from, coalesce(p_to_addresses, '{}'), left(nullif(p_html, ''), 1000000),
            app.normalize_message_id(p_rfc_message_id), app.normalize_message_id(p_in_reply_to),
            coalesce(array(select app.normalize_message_id(r) from unnest(coalesce(p_references, '{}')) r where app.normalize_message_id(r) is not null), '{}'),
            p_authentication);

  -- Attachment *metadata* now; the bytes are fetched, size-checked and stored by the runtime, which
  -- then says so through `record_inbound_attachment_stored`. A provider's temporary link is never kept.
  for v_attachment in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    insert into public.message_attachments (organization_id, message_id, filename, content_type, size_bytes, content_disposition, content_id, provider_attachment_id)
      values (v_identity.organization_id, v_message, left(coalesce(nullif(btrim(v_attachment ->> 'filename'), ''), 'attachment'), 255),
              coalesce(nullif(btrim(v_attachment ->> 'content_type'), ''), 'application/octet-stream'),
              nullif(v_attachment ->> 'size', '')::bigint, v_attachment ->> 'content_disposition', v_attachment ->> 'content_id', v_attachment ->> 'id')
      on conflict do nothing
      returning id into v_att;
    if v_att is not null then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object('id', v_att, 'provider_attachment_id', v_attachment ->> 'id'));
    end if;
  end loop;

  insert into public.message_events (organization_id, message_id, event_type, status_after, provider_event_id, provider_event_at)
    values (v_identity.organization_id, v_message, 'received', 'delivered', p_provider_event_id, v_received)
    on conflict do nothing;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (v_identity.organization_id, '00000000-0000-4000-8000-0000000000a7', 'message', v_message, 'email.received',
            jsonb_build_object('channel', 'email', 'conversation_id', v_conv, 'customer_id', v_customer));

  return jsonb_build_object('message_id', v_message, 'organization_id', v_identity.organization_id, 'attachments', v_pending, 'duplicate', false);
end $$;
revoke all on function public.record_inbound_email(text[], text, text, text, text, text, text[], text, text, text, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_inbound_email(text[], text, text, text, text, text, text[], text, text, text, timestamptz, jsonb, jsonb) to tenant_email_webhook;

-- The runtime saying where it put one received attachment's bytes, or why it did not keep them.
create function public.record_inbound_attachment_stored(
  p_attachment_id uuid, p_storage_path text, p_size_bytes bigint, p_rejection text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_rejection is not null then
    update public.message_attachments set storage_state = 'rejected', rejection_reason = left(p_rejection, 300)
     where id = p_attachment_id and storage_state = 'pending';
    return;
  end if;
  update public.message_attachments
     set storage_state = 'stored', storage_path = p_storage_path, size_bytes = p_size_bytes
   where id = p_attachment_id and storage_state = 'pending'
     and p_storage_path like organization_id::text || '/inbound/%';
  if not found then
    raise exception 'no pending attachment of that kind' using errcode = '22023';
  end if;
end $$;
revoke all on function public.record_inbound_attachment_stored(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_inbound_attachment_stored(uuid, text, bigint, text) to tenant_email_webhook;
