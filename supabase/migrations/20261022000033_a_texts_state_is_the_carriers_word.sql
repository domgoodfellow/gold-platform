-- A text message's state is what the carrier said about it, never what a browser claims — and a
-- carrier's retried or late word cannot undo what is already true.
--
-- **What the audit of the existing SMS path found, and this closes.**
--   1. A signed-in sender could write `status`, `external_id`, `failure_reason` and `sent_at` on its own
--      text row (the insert policy checked nothing about them, and `messages_update` let the creator set any
--      status), so a session could mark its own text `delivered` or `read`. Email never allowed this.
--   2. `record_message_status` wrote whatever status arrived: a late `sent` after `delivered` moved the
--      message backwards, and any carrier word the table's check did not know raised inside the callback.
--   3. `record_inbound_message` upserted the conversation *before* noticing the message was a repeat, so a
--      retried webhook set a conversation the operator had already read back to unread and bumped its time.
--   4. The receiving business was found by `e164` alone: two businesses holding one number, or a number that
--      is no longer active, resolved arbitrarily to one of them (STOP and START the same).
--   5. A callback matched messages by the carrier's id alone, so an id shared by two businesses would have
--      updated both.
--   6. An inbound text was never metered, though the catalogue's `inbound_sms` feature, the `sms_segment`
--      meter and an inbound cost component all exist for it.
-- Nothing here changes what a text *is*: the same `messages` row, the same statuses, the same usage meter.

-- ---------------------------------------------------------------------------
-- 1. No signed-in role writes a text's carrier-owned columns
-- ---------------------------------------------------------------------------
-- A text is created `queued` by its sender and *only* that. What the carrier then did is written by
-- `record_sms_send_result` (the sender reporting what the carrier answered to the send itself, narrowly) and
-- by the carrier's own callbacks (`sms_webhook`).
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'message.send')
    and direction = 'outbound'
    and created_by = (select auth.uid())
    and requested_transport <> 'email'
    and status = 'queued'
    and external_id is null and failure_reason is null and sent_at is null and delivered_at is null and transport is null
  );

drop policy messages_update on public.messages;
revoke update on public.messages from authenticated;

-- ---------------------------------------------------------------------------
-- 2. One forward-only transition, for every writer of a text's status
-- ---------------------------------------------------------------------------
-- Forward only (`app.message_status_rank`): a late `sent` after `delivered` is no change, a late `delivered`
-- after a failure is no change, and a failure after delivery is real. The first time a text reaches `sent`
-- (or beyond) it is billed, once — `record_usage` is idempotent by the message's own reference.
create function app.advance_sms_status(p_organization_id uuid, p_message_id uuid, p_new text, p_failure text)
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
         transport = coalesce(transport, 'sms'),
         sent_at = case when p_new in ('sent', 'delivered', 'read') then coalesce(sent_at, now()) else sent_at end,
         delivered_at = case when p_new in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end
   where organization_id = p_organization_id and id = p_message_id;

  if p_new in ('sent', 'delivered', 'read') then
    perform app.charge_for_message(p_message_id);
  end if;
  return true;
end $$;
revoke all on function app.advance_sms_status(uuid, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- 3. The sender reporting what the carrier answered to the send itself
-- ---------------------------------------------------------------------------
-- Narrow on purpose: the sender's own outbound text, still waiting, may be given the carrier's id and moved
-- to `queued`/`sending`/`sent` (the carrier took it) or `failed` (it did not). It can never be marked
-- `delivered`, `read` or `undelivered` — those are the carrier's callbacks to make.
create function public.record_sms_send_result(
  p_organization_id uuid, p_message_id uuid, p_status text, p_external_id text default null, p_failure_reason text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v public.messages;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_organization_id not in (select app.current_tenant_ids()) or not app.has_capability(p_organization_id, 'message.send') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_status not in ('queued', 'sending', 'sent', 'failed') then
    raise exception 'a send can only be reported as queued, sending, sent or failed' using errcode = '22023';
  end if;

  select * into v from public.messages
   where organization_id = p_organization_id and id = p_message_id
     and created_by = (select auth.uid()) and direction = 'outbound' and requested_transport = 'sms'
   for update;
  if not found then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if v.status not in ('queued', 'sending') then
    return;
  end if;

  if p_external_id is not null and v.external_id is null then
    update public.messages set external_id = p_external_id, transport = 'sms'
     where organization_id = p_organization_id and id = p_message_id;
  end if;
  perform app.advance_sms_status(p_organization_id, p_message_id, p_status, left(p_failure_reason, 500));
end $$;
revoke all on function public.record_sms_send_result(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.record_sms_send_result(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Which business a number belongs to: exactly one, and active
-- ---------------------------------------------------------------------------
-- The carrier names the number a text arrived at; the business is derived from it and from nothing the
-- carrier or a browser supplies. A number held by two businesses, or held by none that is active, is not
-- anyone's here — it is refused rather than guessed at.
create function app.sms_number_owner(p_e164 text, p_require_inbound boolean)
returns table (organization_id uuid, phone_number_id uuid)
language sql stable security definer set search_path = '' as $$
  select (array_agg(n.organization_id))[1], (array_agg(n.id))[1]
    from public.phone_numbers n
   where n.e164 = p_e164 and n.lifecycle = 'active' and (not p_require_inbound or n.inbound_enabled)
  having count(*) = 1
$$;
revoke all on function app.sms_number_owner(text, boolean) from public;

-- ---------------------------------------------------------------------------
-- 5. The carrier's callbacks
-- ---------------------------------------------------------------------------
create or replace function public.record_inbound_message(
  p_to_number text, p_from_number text, p_external_id text, p_body text
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_number uuid; v_conversation uuid; v_message uuid;
begin
  select o.organization_id, o.phone_number_id into v_org, v_number from app.sms_number_owner(p_to_number, true) o;
  if v_org is null then
    return null;
  end if;

  -- The same text delivered again (a retried callback) is nothing new: it must not make a conversation a
  -- person has already read unread again, nor move it up the list, nor be billed a second time.
  if exists (select 1 from public.messages m where m.organization_id = v_org and m.external_id = p_external_id) then
    return null;
  end if;

  insert into public.conversations (organization_id, phone_number_id, external_number, last_message_at, last_message_preview, unread)
    values (v_org, v_number, p_from_number, now(), left(p_body, 280), true)
    on conflict (organization_id, phone_number_id, external_number) do update
      set last_message_at = excluded.last_message_at, last_message_preview = excluded.last_message_preview, unread = true
    returning id into v_conversation;

  insert into public.messages (organization_id, conversation_id, direction, status, body, requested_transport, transport, external_id, sent_at, delivered_at)
    values (v_org, v_conversation, 'inbound', 'delivered', p_body, 'sms', 'sms', p_external_id, now(), now())
    on conflict (organization_id, external_id) do nothing
    returning id into v_message;

  -- A text received is metered the way one sent is (`inbound_sms`, `sms_segment`), once, by the message.
  if v_message is not null then
    perform app.charge_for_message(v_message);
  end if;
  return v_message;
end $$;

create or replace function public.record_message_suppression(
  p_to_number text, p_external_number text, p_opted_out boolean
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select o.organization_id into v_org from app.sms_number_owner(p_to_number, false) o;
  if v_org is null then
    return;
  end if;

  insert into public.messaging_opt_outs (organization_id, external_number, opted_out, source, occurred_at)
    values (v_org, p_external_number, p_opted_out, 'keyword', now())
    on conflict (organization_id, external_number) do update
      set opted_out = excluded.opted_out, source = 'keyword', occurred_at = now();
end $$;

-- A delivery callback about one text. The carrier's id must name exactly one outbound text — an id nobody
-- here sent, or one that two businesses somehow share, is not acted on — and the status must already be this
-- platform's own vocabulary (the carrier's words are translated at the provider boundary, not here).
create or replace function public.record_message_status(
  p_external_id text, p_status text, p_failure_reason text default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_count integer;
begin
  if p_status not in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered') then
    raise exception 'unknown message status: %', p_status using errcode = '22023';
  end if;

  select count(*), (array_agg(m.organization_id))[1], (array_agg(m.id))[1] into v_count, v_org, v_id
    from public.messages m
   where m.external_id = p_external_id and m.direction = 'outbound' and m.requested_transport = 'sms';
  if v_count <> 1 then
    return null;
  end if;

  perform app.advance_sms_status(v_org, v_id, p_status, left(p_failure_reason, 500));
  return v_id;
end $$;
