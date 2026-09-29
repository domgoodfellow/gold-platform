-- ---------------------------------------------------------------------------
-- message.send: a new capability, not a silent widening of call.place
-- ---------------------------------------------------------------------------
-- Answering the phone and sending a text are two different trusts an operator can hold
-- independently (a receptionist may message customers without ever placing a call, and the
-- reverse) -- so this is its own capability, granted on sign-up to every role that already holds
-- `call.place`, the reasonable default a business that has not yet touched its own roles gets,
-- exactly as `call.place` itself arrived auto-granted to `organization.manage` holders.
do $$
declare
  v_capabilities text[];
  v_constraint text;
begin
  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass
     and c.conname = 'roles_capabilities_known';

  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[])
    into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  if not ('message.send' = any (v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'message.send');

    alter table public.roles drop constraint roles_capabilities_known;
    execute format(
      'alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
      (select string_agg(quote_literal(capability), ', ' order by capability)
         from unnest(v_capabilities) as capability)
    );
  end if;
end
$$;

update public.roles
   set capabilities = capabilities || array['message.send']::text[]
 where 'call.place' = any (capabilities)
   and not ('message.send' = any (capabilities));

-- Work Order 6: one Messaging capability, SMS/MMS/RCS as transports of one Message — never
-- three products. A tenant sees a conversation; which transport carried a given message is this
-- schema's own resolved fact, not something three separate tables would each answer differently.
--
-- RCS and MMS are real, named vocabulary here (`messages.requested_transport`/`transport` both
-- name all three) but this slice's one writer (`lib/domain/reception/messaging.ts`'s `sendMessage`)
-- only ever resolves `sms` — there is no RCS sender approval flow and no attachment pipeline
-- wired yet, so claiming either would be exactly the fake toggle the work order refuses. The
-- vocabulary exists so a later slice extends the resolver rather than replacing the schema.

create table public.conversations (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations (id) on delete cascade,
  customer_id         uuid        null,
  -- The business's own number this conversation happens through — a conversation is scoped to
  -- one sender identity, the same way a call's room is scoped to one calling number.
  phone_number_id     uuid        not null,
  external_number     text        not null check (external_number ~ '^\+[1-9][0-9]{7,14}$'),
  last_message_at     timestamptz not null default now(),
  last_message_preview text       not null default '' check (length(last_message_preview) <= 280),
  unread              boolean     not null default false,
  created_at          timestamptz not null default now(),

  unique (organization_id, id),
  -- One conversation per (our number, their number) pair — the natural key a carrier's own
  -- inbound webhook already has (`To`/`From`), so resolving "which conversation" never guesses.
  unique (organization_id, phone_number_id, external_number),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete set null,
  foreign key (organization_id, phone_number_id) references public.phone_numbers (organization_id, id) on delete cascade
);

create index conversations_org_last_message_idx on public.conversations (organization_id, last_message_at desc);

alter table public.conversations enable row level security;
alter table public.conversations force row level security;

create policy conversations_select on public.conversations
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Tenant self-service, `message.send`-gated, the same shape `calls_insert`/`calls_update`
-- already are for `call.place` — never a staff-only SECURITY DEFINER door, because sending a
-- message is this business's own act, not platform infrastructure.
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send'));

create policy conversations_update on public.conversations
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send'));

grant select, insert on public.conversations to authenticated;
-- Only what a person marking a thread read or the sender's own send path touches — never the
-- number or the customer link, which are this conversation's own identity (I8).
grant update (last_message_at, last_message_preview, unread) on public.conversations to authenticated;

create table public.messages (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations (id) on delete cascade,
  conversation_id     uuid        not null,
  direction           text        not null check (direction in ('inbound', 'outbound')),
  status              text        not null default 'queued'
                        check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered')),
  -- Consent and urgency are not the same for every message (the work order's own point) — named
  -- now even though every writer in this slice sends `conversational`, so a future marketing or
  -- lifecycle sender has somewhere real to say so rather than a column added under it later.
  intent               text       not null default 'conversational'
                        check (intent in ('conversational', 'transactional', 'lifecycle', 'marketing')),
  body                 text       not null default '' check (length(body) <= 1600),
  requested_transport  text       not null default 'sms' check (requested_transport in ('sms', 'mms', 'rcs')),
  transport            text       null check (transport in ('sms', 'mms', 'rcs')),
  external_id          text       null,
  failure_reason       text       null,
  -- A caller-supplied key, not a database default: two requests with the same key are the same
  -- attempt, the entire idempotency guarantee (I6's reasoning, restated for a browser retry
  -- rather than a database race).
  idempotency_key      text       null,
  created_by           uuid       null references auth.users (id),
  created_at           timestamptz not null default now(),
  sent_at              timestamptz null,
  delivered_at         timestamptz null,

  unique (organization_id, id),
  unique (organization_id, external_id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade
);

create index messages_org_conversation_idx on public.messages (organization_id, conversation_id, created_at);

alter table public.messages enable row level security;
alter table public.messages force row level security;

create policy messages_select on public.messages
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'message.send')
    and direction = 'outbound'
    and created_by = auth.uid()
  );

-- The sender's own session may correct its own just-sent row when the carrier's own REST call
-- answers or refuses (mirroring `calls_update`'s exact reasoning) — never anybody else's message,
-- and never the terminal delivered/read/failed-by-carrier states, which arrive only through
-- `record_message_status` (SECURITY DEFINER, the webhook's own door, matching `record_call_event`).
create policy messages_update on public.messages
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send') and created_by = auth.uid())
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'message.send') and created_by = auth.uid());

grant select, insert on public.messages to authenticated;
grant update (status, transport, external_id, failure_reason, sent_at) on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Suppression: who has said STOP. Written only by the keyword-detecting webhook in this slice —
-- a signed-in caller cannot un-suppress or suppress a number by any path this migration grants.
-- ---------------------------------------------------------------------------
create table public.messaging_opt_outs (
  organization_id   uuid        not null references public.organizations (id) on delete cascade,
  external_number   text        not null check (external_number ~ '^\+[1-9][0-9]{7,14}$'),
  opted_out         boolean     not null default true,
  source            text        not null check (source in ('keyword', 'manual')),
  occurred_at       timestamptz not null default now(),
  primary key (organization_id, external_number)
);

alter table public.messaging_opt_outs enable row level security;
alter table public.messaging_opt_outs force row level security;

create policy messaging_opt_outs_select on public.messaging_opt_outs
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- No insert/update/delete grant to any signed-in role, matching D40's rule restated for this
-- axis: a business cannot suppress or un-suppress a number by selecting a different one, because
-- there is no write path here at all except the fixed `sms_webhook` role's own door below.

-- ---------------------------------------------------------------------------
-- Messaging's own machine role — the SMS analogue of `voice_webhook` (D26).
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role) values ('00000000-0000-4000-8000-0000000000a5', 'authenticated', 'authenticated')
  on conflict (id) do nothing;
create role sms_webhook nologin noinherit;
grant sms_webhook to authenticator;
grant usage on schema public to sms_webhook;

-- ---------------------------------------------------------------------------
-- record_inbound_message: the one writer of an inbound message and its conversation.
--
-- **Organization and number are derived here, from the carrier's own `To`, never accepted as
-- arguments** — the same rule `record_call_event` holds for a call: a callback that could name
-- an organization could name somebody else's. `p_to_number` is the only identifying input, and
-- it must already be one of this deployment's own numbers or nothing is written.
-- ---------------------------------------------------------------------------
create function public.record_inbound_message(
  p_to_number text,
  p_from_number text,
  p_external_id text,
  p_body text
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_organization_id uuid; v_phone_number_id uuid; v_conversation_id uuid; v_message_id uuid;
begin
  select organization_id, id into v_organization_id, v_phone_number_id
    from public.phone_numbers
   where e164 = p_to_number and inbound_enabled;

  if v_organization_id is null then
    return null;
  end if;

  insert into public.conversations (organization_id, phone_number_id, external_number, last_message_at, last_message_preview, unread)
    values (v_organization_id, v_phone_number_id, p_from_number, now(), left(p_body, 280), true)
    on conflict (organization_id, phone_number_id, external_number) do update
      set last_message_at = excluded.last_message_at, last_message_preview = excluded.last_message_preview, unread = true
    returning id into v_conversation_id;

  insert into public.messages (organization_id, conversation_id, direction, status, body, requested_transport, transport, external_id, sent_at, delivered_at)
    values (v_organization_id, v_conversation_id, 'inbound', 'delivered', p_body, 'sms', 'sms', p_external_id, now(), now())
    on conflict (organization_id, external_id) do nothing
    returning id into v_message_id;

  return v_message_id;
end $$;
revoke all on function public.record_inbound_message(text, text, text, text) from public;
grant execute on function public.record_inbound_message(text, text, text, text) to sms_webhook;

-- ---------------------------------------------------------------------------
-- record_message_status: the webhook's own door onto an outbound message's terminal state.
-- ---------------------------------------------------------------------------
create function public.record_message_status(
  p_external_id text,
  p_status text,
  p_failure_reason text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.messages
     set status = p_status,
         failure_reason = coalesce(p_failure_reason, failure_reason),
         delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end
   where external_id = p_external_id
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_message_status(text, text, text) from public;
grant execute on function public.record_message_status(text, text, text) to sms_webhook;

-- ---------------------------------------------------------------------------
-- record_message_suppression: STOP/START, the one writer of messaging_opt_outs.
--
-- **The organization is derived from `p_to_number` here too** — the same rule
-- `record_inbound_message` holds, and for the same reason: `sms_webhook` holds no table grant
-- on `phone_numbers` at all (D40's rule, restated once more for this axis), so there is no other
-- door this handler could resolve an organization through even if it tried.
-- ---------------------------------------------------------------------------
create function public.record_message_suppression(
  p_to_number text,
  p_external_number text,
  p_opted_out boolean
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_organization_id uuid;
begin
  select organization_id into v_organization_id from public.phone_numbers where e164 = p_to_number;
  if v_organization_id is null then
    return;
  end if;

  insert into public.messaging_opt_outs (organization_id, external_number, opted_out, source, occurred_at)
    values (v_organization_id, p_external_number, p_opted_out, 'keyword', now())
    on conflict (organization_id, external_number) do update
      set opted_out = excluded.opted_out, source = 'keyword', occurred_at = now();
end $$;
revoke all on function public.record_message_suppression(text, text, boolean) from public;
grant execute on function public.record_message_suppression(text, text, boolean) to sms_webhook;

-- ---------------------------------------------------------------------------
-- charge_for_message: segments -> sms_segment usage, the exact shape charge_for_call already is.
-- ---------------------------------------------------------------------------
create function app.charge_for_message(p_message_id uuid) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_message public.messages; v_segments integer; v_binding uuid; v_resource uuid; v_feature uuid;
begin
  select m.* into v_message from public.messages m where m.id = p_message_id;
  if not found or v_message.direction <> 'outbound' then return; end if;

  -- GSM-7 single-segment length is 160; this is the honest single-segment estimate this slice
  -- makes, not a full GSM-7-vs-UCS-2 encoding detector -- a real gap, left for the day a message
  -- actually needs one, per the same "not yet built" discipline `browserTelephoneToken`'s own
  -- account-scoping gap is held to.
  v_segments := greatest(1, ceil(length(v_message.body)::numeric / 160)::integer);

  select r.id, r.binding_id
    into v_resource, v_binding
    from public.conversations c
    join public.phone_numbers n on n.organization_id = c.organization_id and n.id = c.phone_number_id
    join public.organization_provider_resources r on r.organization_id = n.organization_id and r.id = n.provider_resource_id
    join public.organization_provider_bindings b on b.organization_id = r.organization_id and b.id = r.binding_id and b.provider_key = 'twilio'
   where c.organization_id = v_message.organization_id and c.id = v_message.conversation_id;

  if v_binding is null then
    select b.id into v_binding from public.organization_provider_bindings b
     where b.organization_id = v_message.organization_id and b.provider_key = 'twilio';
  end if;

  select f.id into v_feature
    from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
   where m.key = 'sms' and f.key = 'outbound_sms';

  perform app.record_usage(
    v_message.organization_id, 'sms_segment', v_segments, 'twilio', now(),
    v_feature, v_binding, v_resource, v_message.id::text, format('message %s', v_message.id));
end $$;
revoke all on function app.charge_for_message(uuid) from public;

-- record_message_status charges usage the moment a send is confirmed (`sent`), mirroring
-- `charge_for_call`'s own terminal-status trigger point -- a message never bills twice, because
-- `charge_for_message` is reached only from here and only once a status transitions to `sent`.
create or replace function public.record_message_status(
  p_external_id text,
  p_status text,
  p_failure_reason text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_previous_status text;
begin
  select status into v_previous_status from public.messages where external_id = p_external_id;

  update public.messages
     set status = p_status,
         failure_reason = coalesce(p_failure_reason, failure_reason),
         delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end
   where external_id = p_external_id
  returning id into v_id;

  if v_id is not null and p_status = 'sent' and v_previous_status is distinct from 'sent' then
    perform app.charge_for_message(v_id);
  end if;

  return v_id;
end $$;
revoke all on function public.record_message_status(text, text, text) from public;
grant execute on function public.record_message_status(text, text, text) to sms_webhook;
