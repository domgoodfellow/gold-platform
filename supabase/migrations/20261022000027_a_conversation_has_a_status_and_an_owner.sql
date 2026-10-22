-- A conversation is something a person handles: it has a state, a person responsible for it, and a
-- customer it is about — three separate facts, each owned here and none of them CRM's.
--
-- **Status is lightweight on purpose.** `open` means an answer is expected from the business,
-- `waiting` means the business has answered and is waiting on the other side, `closed` means nothing
-- more is expected. Three words, not a ticket workflow: no severity, no SLA, no category.
--
-- **Assignment is one column, history is the event log.** A conversation has zero or one current
-- assignee (`assignee_membership_id`), so two current owners cannot exist by construction. Who held it
-- before, and who changed it, is the `events` trail every other part of the platform already writes;
-- no second history table. The assignee is a *membership* (a person in this business), never a global
-- user id, and the foreign key is tenant-leading so another business's member cannot be named.
-- Assignment is not CRM ownership: nothing here touches `customers`.
--
-- **Doors, not grants.** No signed-in role may write `status`, `assignee_membership_id` or
-- `customer_id` on a conversation directly. Each change is a function that checks the caller may
-- handle conversations here (`message.send`), checks what it points at, and writes the event.

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column status text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  add column status_changed_at timestamptz not null default now(),
  add column assignee_membership_id uuid null;

alter table public.conversations
  add constraint conversations_assignee_fk
    foreign key (organization_id, assignee_membership_id)
    references public.memberships (organization_id, id)
    on delete set null (assignee_membership_id);

comment on column public.conversations.status is
  'open: an answer is expected from this business. waiting: this business has answered and awaits the other side. closed: nothing more is expected. Not a ticket state.';
comment on column public.conversations.assignee_membership_id is
  'The one person (membership) currently responsible for this conversation, or null. Independent of any CRM owner of the customer.';

-- Indexes for the Inbox's real queries (recent activity, optionally narrowed), each leading with the
-- organization (I2) and ending in `id` so keyset pagination has a total order.
drop index if exists public.conversations_org_last_message_idx;
create index conversations_org_activity_idx on public.conversations (organization_id, last_message_at desc, id desc);
create index conversations_org_channel_idx  on public.conversations (organization_id, channel, last_message_at desc, id desc);
create index conversations_org_status_idx   on public.conversations (organization_id, status, last_message_at desc, id desc);
create index conversations_org_unread_idx   on public.conversations (organization_id, last_message_at desc, id desc) where unread;
create index conversations_org_assignee_idx on public.conversations (organization_id, assignee_membership_id, last_message_at desc, id desc)
  where assignee_membership_id is not null;

-- The activity beside a conversation's messages (assigned, closed, linked) is read by entity.
create index if not exists events_entity_idx on public.events (organization_id, entity_type, entity_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Contact points: one normalization, one rule
-- ---------------------------------------------------------------------------

-- E.164, or null. Only an *unambiguous* international form is accepted — a leading `+` or `00` —
-- because a number written without a country code does not say which country it is in, and guessing
-- one would match the wrong person. Formatting (spaces, dots, dashes, parentheses) is ignored.
create function app.normalize_phone(p_value text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_value, '')); d text;
begin
  if left(v, 1) = '+' then
    d := regexp_replace(substr(v, 2), '[^0-9]', '', 'g');
  elsif left(v, 2) = '00' then
    d := regexp_replace(substr(v, 3), '[^0-9]', '', 'g');
  else
    return null;
  end if;
  return case when d ~ '^[1-9][0-9]{7,14}$' then '+' || d end;
end $$;
revoke all on function app.normalize_phone(text) from public;

-- Trimmed and lowercased, nothing cleverer. Provider-specific rules (a Gmail address's dots, a
-- `+tag`) are not identity truth everywhere, so they are not applied anywhere.
create function app.normalize_email(p_value text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(btrim(coalesce(p_value, ''))), '')
$$;
revoke all on function app.normalize_email(text) from public;

-- Every customer *in this organization* that holds this contact point. Never across organizations:
-- the same address in two businesses is two unrelated facts.
create function app.contact_matches(p_organization_id uuid, p_kind text, p_value text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id
    from public.customers c
   where c.organization_id = p_organization_id
     and case p_kind
           when 'email' then app.normalize_email(p_value) is not null and app.normalize_email(c.email) = app.normalize_email(p_value)
           when 'phone' then app.normalize_phone(p_value) is not null and app.normalize_phone(c.phone) = app.normalize_phone(p_value)
           else false end
$$;
revoke all on function app.contact_matches(uuid, text, text) from public;

-- Resolved only when exactly one customer holds it. None is unresolved, several is ambiguous, and
-- neither is guessed at.
create function app.resolve_customer(p_organization_id uuid, p_kind text, p_value text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then (array_agg(id))[1] end from app.contact_matches(p_organization_id, p_kind, p_value) id
$$;
revoke all on function app.resolve_customer(uuid, text, text) from public;

-- A new conversation is about a known customer when its external contact point names exactly one,
-- whichever writer created it. No customer is ever created here.
create function app.resolve_new_conversation_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null then
    new.customer_id := case new.channel
      when 'sms'   then app.resolve_customer(new.organization_id, 'phone', new.external_number)
      when 'email' then app.resolve_customer(new.organization_id, 'email', new.external_email)
    end;
  end if;
  return new;
end $$;
revoke all on function app.resolve_new_conversation_customer() from public;

create trigger conversations_resolve_customer
  before insert on public.conversations
  for each row execute function app.resolve_new_conversation_customer();

-- ---------------------------------------------------------------------------
-- A system actor for changes nobody in particular made (a customer replied)
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role) values ('00000000-0000-4000-8000-0000000000a8', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

create function app.record_conversation_event(p_organization_id uuid, p_conversation_id uuid, p_actor uuid, p_action text, p_payload jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, coalesce(p_actor, '00000000-0000-4000-8000-0000000000a8'), 'conversation', p_conversation_id, p_action, coalesce(p_payload, '{}'::jsonb))
$$;
revoke all on function app.record_conversation_event(uuid, uuid, uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Status follows the conversation, conservatively
-- ---------------------------------------------------------------------------
-- A message from the other side means they are waiting on us: the conversation is `open`, reopened if
-- it had been closed. An answer from us that actually *left* (sent, never merely queued) moves an
-- `open` conversation to `waiting`; a `closed` one stays closed, because closing was a deliberate act.
-- A delivery callback never touches a conversation's state or its unread flag: only these two events do.
create function app.conversation_follows_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_next text; v_reason text;
begin
  if tg_op = 'INSERT' and new.direction = 'inbound' then
    v_next := 'open'; v_reason := 'inbound_message';
  elsif new.direction = 'outbound' and new.status in ('sent', 'delivered')
        and (tg_op = 'INSERT' or old.status is distinct from new.status) and (tg_op = 'INSERT' or old.status not in ('sent', 'delivered')) then
    v_next := 'waiting'; v_reason := 'outbound_message';
  else
    return null;
  end if;

  select status into v_status from public.conversations
   where organization_id = new.organization_id and id = new.conversation_id for update;
  if v_status is null or v_status = v_next then return null; end if;
  if v_reason = 'outbound_message' and v_status <> 'open' then return null; end if;

  update public.conversations set status = v_next, status_changed_at = now()
   where organization_id = new.organization_id and id = new.conversation_id;
  perform app.record_conversation_event(new.organization_id, new.conversation_id, null,
    'conversation.' || case v_next when 'open' then 'opened' else 'waiting' end,
    jsonb_build_object('from', v_status, 'to', v_next, 'automatic', true, 'reason', v_reason));
  return null;
end $$;
revoke all on function app.conversation_follows_message() from public;

create trigger messages_conversation_follows_insert
  after insert on public.messages
  for each row execute function app.conversation_follows_message();
create trigger messages_conversation_follows_status
  after update of status on public.messages
  for each row execute function app.conversation_follows_message();

-- ---------------------------------------------------------------------------
-- The doors
-- ---------------------------------------------------------------------------

-- Who may handle conversations here, and the conversation, locked for the change.
create function app.lock_conversation_for_handling(p_organization_id uuid, p_conversation_id uuid)
returns public.conversations language plpgsql volatile security definer set search_path = '' as $$
declare v public.conversations;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'message.send') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select * into v from public.conversations where organization_id = p_organization_id and id = p_conversation_id for update;
  if not found then
    -- One answer for "no such conversation" and "somebody else's".
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function app.lock_conversation_for_handling(uuid, uuid) from public;

-- Whether a membership belongs to this organization and holds the authority to handle conversations.
create function app.membership_can_handle_conversations(p_organization_id uuid, p_membership_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
     where m.organization_id = p_organization_id and m.id = p_membership_id and 'message.send' = any (r.capabilities))
$$;
revoke all on function app.membership_can_handle_conversations(uuid, uuid) from public;

create function app.current_membership(p_organization_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.memberships m where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
$$;
revoke all on function app.current_membership(uuid) from public;

-- Take an unassigned conversation. Two people pressing at once: the row is locked, so the second sees
-- it taken and gets `false` — exactly one of them is ever the assignee.
create function public.claim_conversation(p_organization_id uuid, p_conversation_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v public.conversations; me uuid;
begin
  v := app.lock_conversation_for_handling(p_organization_id, p_conversation_id);
  me := app.current_membership(p_organization_id);
  if me is null then raise exception 'insufficient privilege' using errcode = '42501'; end if;
  if v.assignee_membership_id is not null then return false; end if;
  update public.conversations set assignee_membership_id = me where organization_id = p_organization_id and id = p_conversation_id;
  perform app.record_conversation_event(p_organization_id, p_conversation_id, (select auth.uid()), 'conversation.assigned',
    jsonb_build_object('assignee_membership_id', me, 'claimed', true));
  return true;
end $$;
revoke all on function public.claim_conversation(uuid, uuid) from public, anon;
grant execute on function public.claim_conversation(uuid, uuid) to authenticated;

-- Give a conversation to a person, or take it from one and give it to another. The assignee must be a
-- member of this business who can handle conversations; another business's member cannot be named.
create function public.assign_conversation(p_organization_id uuid, p_conversation_id uuid, p_membership_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.conversations;
begin
  v := app.lock_conversation_for_handling(p_organization_id, p_conversation_id);
  if not app.membership_can_handle_conversations(p_organization_id, p_membership_id) then
    raise exception 'that person cannot be assigned conversations here' using errcode = '22023';
  end if;
  if v.assignee_membership_id is not distinct from p_membership_id then return; end if;

  update public.conversations set assignee_membership_id = p_membership_id where organization_id = p_organization_id and id = p_conversation_id;
  perform app.record_conversation_event(p_organization_id, p_conversation_id, (select auth.uid()),
    case when v.assignee_membership_id is null then 'conversation.assigned' else 'conversation.reassigned' end,
    jsonb_build_object('assignee_membership_id', p_membership_id, 'previous_membership_id', v.assignee_membership_id));
end $$;
revoke all on function public.assign_conversation(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_conversation(uuid, uuid, uuid) to authenticated;

create function public.release_conversation(p_organization_id uuid, p_conversation_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.conversations;
begin
  v := app.lock_conversation_for_handling(p_organization_id, p_conversation_id);
  if v.assignee_membership_id is null then return; end if;
  update public.conversations set assignee_membership_id = null where organization_id = p_organization_id and id = p_conversation_id;
  perform app.record_conversation_event(p_organization_id, p_conversation_id, (select auth.uid()), 'conversation.released',
    jsonb_build_object('previous_membership_id', v.assignee_membership_id));
end $$;
revoke all on function public.release_conversation(uuid, uuid) from public, anon;
grant execute on function public.release_conversation(uuid, uuid) to authenticated;

create function public.set_conversation_status(p_organization_id uuid, p_conversation_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.conversations;
begin
  if p_status not in ('open', 'waiting', 'closed') then
    raise exception 'unknown conversation status: %', p_status using errcode = '22023';
  end if;
  v := app.lock_conversation_for_handling(p_organization_id, p_conversation_id);
  if v.status = p_status then return; end if;
  update public.conversations set status = p_status, status_changed_at = now() where organization_id = p_organization_id and id = p_conversation_id;
  perform app.record_conversation_event(p_organization_id, p_conversation_id, (select auth.uid()),
    'conversation.' || case p_status when 'open' then 'opened' when 'waiting' then 'waiting' else 'closed' end,
    jsonb_build_object('from', v.status, 'to', p_status));
end $$;
revoke all on function public.set_conversation_status(uuid, uuid, text) from public, anon;
grant execute on function public.set_conversation_status(uuid, uuid, text) to authenticated;

-- Point a conversation at a customer of this business, or at nobody. Never creates or edits a customer,
-- and never adds the contact point to one: this associates a conversation with CRM context, nothing more.
create function public.link_conversation_customer(p_organization_id uuid, p_conversation_id uuid, p_customer_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.conversations;
begin
  v := app.lock_conversation_for_handling(p_organization_id, p_conversation_id);
  if p_customer_id is not null and not exists (select 1 from public.customers c where c.organization_id = p_organization_id and c.id = p_customer_id) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if v.customer_id is not distinct from p_customer_id then return; end if;

  update public.conversations set customer_id = p_customer_id where organization_id = p_organization_id and id = p_conversation_id;
  perform app.record_conversation_event(p_organization_id, p_conversation_id, (select auth.uid()),
    case when p_customer_id is null then 'conversation.customer_unlinked' else 'conversation.customer_linked' end,
    jsonb_build_object('customer_id', p_customer_id, 'previous_customer_id', v.customer_id));
end $$;
revoke all on function public.link_conversation_customer(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_conversation_customer(uuid, uuid, uuid) to authenticated;

-- Which customers of this business hold this conversation's contact point — for the screen that offers
-- to link one. Within this organization only, and the caller must belong to it.
create function public.conversation_customer_candidates(p_organization_id uuid, p_conversation_id uuid)
returns table (customer_id uuid, name text, email text, phone text)
language plpgsql stable security definer set search_path = '' as $$
declare v public.conversations;
begin
  if p_organization_id not in (select app.current_tenant_ids()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select * into v from public.conversations where organization_id = p_organization_id and id = p_conversation_id;
  if not found then return; end if;
  return query
    select c.id, c.name, c.email, c.phone
      from app.contact_matches(p_organization_id,
             case v.channel when 'sms' then 'phone' else 'email' end,
             case v.channel when 'sms' then v.external_number else v.external_email end) m
      join public.customers c on c.organization_id = p_organization_id and c.id = m
     order by c.name, c.id;
end $$;
revoke all on function public.conversation_customer_candidates(uuid, uuid) from public, anon;
grant execute on function public.conversation_customer_candidates(uuid, uuid) to authenticated;
