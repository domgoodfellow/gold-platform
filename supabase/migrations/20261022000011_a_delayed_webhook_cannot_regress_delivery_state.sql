-- The current status a person reads was "the latest row by occurred_at" -- when that row's
-- `occurred_at` is the moment apps/api *received* the callback, a retried or merely delayed
-- older event arriving after a newer one already landed could read as current. Work order 1
-- closeout, section 4.
--
-- **Two separate facts, both kept.** `occurred_at` stays exactly what it always was: when this
-- platform learned the fact, set once at insert and never touched again -- the ingestion time a
-- carrier-retry audit already depends on elsewhere in this schema (`call_events`). `provider_event_at`
-- is the new, second fact: the moment Resend itself says the event happened (`body.created_at` in
-- its own verified payload), null for a `send`-sourced row, which has no such moment to report.
-- Current status reads `coalesce(provider_event_at, occurred_at)` -- a webhook row's own answer
-- when it has one, ingestion time otherwise -- so a late-arriving but chronologically earlier
-- event can never read as newer than one that already landed.

alter table public.invitation_deliveries
  add column provider_event_at timestamptz;

comment on column public.invitation_deliveries.provider_event_at is
  'The moment Resend says this event happened (its own payload''s created_at), not when this platform heard about it -- null for a send-sourced row. Current status orders by coalesce(provider_event_at, occurred_at), never occurred_at alone, so a delayed or retried callback cannot regress a newer one.';

create index invitation_deliveries_org_invitation_current_idx
  on public.invitation_deliveries (organization_id, invitation_id, coalesce(provider_event_at, occurred_at) desc);

-- A new parameter is a new overload unless the old signature is dropped first -- this is a
-- replacement, not an addition, so the five-argument version must not survive beside it.
drop function if exists public.record_invitation_delivery_event(text, text, text, jsonb, text);

create function public.record_invitation_delivery_event(
  p_provider_message_id text,
  p_state               text,
  p_detail              text,
  p_payload             jsonb,
  p_payload_hash        text,
  p_event_at            timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org        uuid;
  v_invitation uuid;
  v_recipient  text;
  v_id         uuid;
begin
  if p_state not in ('sent', 'delivered', 'delayed', 'bounced', 'failed', 'suppressed') then
    raise exception 'unknown delivery state: %', p_state using errcode = '22023';
  end if;

  select organization_id, invitation_id, recipient
    into v_org, v_invitation, v_recipient
    from public.invitation_deliveries
   where provider_message_id = p_provider_message_id and source = 'send'
   order by occurred_at desc
   limit 1;

  if v_org is null then
    -- Nothing to attach to: a message id from another deployment sharing the account, or one this
    -- platform never sent. Not an error, the same reasoning record_call_event gives.
    return null;
  end if;

  insert into public.invitation_deliveries
    (organization_id, invitation_id, recipient, source, state, provider_message_id, detail, payload, payload_hash, provider_event_at)
  values
    (v_org, v_invitation, v_recipient, 'webhook', p_state, p_provider_message_id, p_detail,
     coalesce(p_payload, '{}'::jsonb), p_payload_hash, p_event_at)
  on conflict (organization_id, payload_hash) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_invitation_delivery_event(text, text, text, jsonb, text, timestamptz) is
  'The only thing invitation_email_webhook may do. Derives the organization and invitation from the send row the provider''s own message id already belongs to; the caller names neither. p_event_at is the provider''s own timestamp from its verified payload, kept apart from occurred_at (when this platform heard it) so a delayed delivery cannot regress a newer one.';

revoke all on function public.record_invitation_delivery_event(text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_invitation_delivery_event(text, text, text, jsonb, text, timestamptz) to invitation_email_webhook;
