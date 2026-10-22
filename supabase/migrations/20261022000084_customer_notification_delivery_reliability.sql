-- Customer notification delivery reliability: lease fencing, early provider callbacks, pinned
-- provider scope and bounded worker execution. Forward from 20261219000001; applied migrations are
-- immutable.
begin;

-- ---------------------------------------------------------------------------
-- Provider scope pinned to a job, and the facts that decide whether a retry is safe
-- ---------------------------------------------------------------------------

-- `dispatched_at` is the first time a send was authorized: from then on an attempt may have
-- reached the provider, and only the same provider account within its idempotency window can
-- safely be asked again. `held` is a delivery the platform cannot settle or retry on its own.
alter table app.notification_jobs
  add column provider_key text,
  add column provider_account_id uuid,
  add column provider_binding_id uuid,
  add column provider_pinned_at timestamptz,
  add column dispatched_at timestamptz;
alter table app.notification_jobs drop constraint notification_jobs_state_check;
alter table app.notification_jobs add constraint notification_jobs_state_check
  check (state in ('queued', 'sending', 'accepted', 'suppressed', 'failed', 'held'));

create function app.notification_provider_scope(org uuid, identity_id uuid)
returns table (provider_key text, provider_account_id uuid, binding_id uuid)
language sql stable security definer set search_path = '' as $$
  select b.provider_key, b.provider_account_id, b.id
    from public.email_identities e
    join public.organization_provider_resources r on r.organization_id = e.organization_id and r.id = e.sending_domain_resource_id
    join public.organization_provider_bindings b on b.organization_id = r.organization_id and b.id = r.binding_id
   where e.organization_id = org and e.id = identity_id
$$;
revoke all on function app.notification_provider_scope(uuid, uuid) from public, anon, authenticated;

-- Jobs already in flight keep the scope they now resolve to. One that was ever claimed is treated
-- as possibly dispatched, because nothing recorded whether its send was authorized.
update app.notification_jobs j
   set provider_key = s.provider_key, provider_account_id = s.provider_account_id, provider_binding_id = s.binding_id,
       provider_pinned_at = now(), dispatched_at = case when j.attempts > 0 then j.first_attempt_at end
  from app.notification_jobs base
 cross join lateral app.notification_provider_scope(base.organization_id, base.email_identity_id) s
 where base.organization_id = j.organization_id and base.id = j.id and j.state in ('queued', 'sending');

-- A definitive provider answer (accepted with its id, or refused) that arrived after its lease
-- ended. The next claim settles the job from it rather than sending the message a second time.
create table app.notification_send_evidence (
  organization_id uuid not null,
  job_id uuid not null,
  lease_id uuid not null,
  outcome text not null check (outcome in ('accepted', 'rejected')),
  external_id text check (outcome <> 'accepted' or nullif(btrim(external_id), '') is not null),
  recorded_at timestamptz not null default now(),
  reconciled_at timestamptz,
  primary key (organization_id, job_id, lease_id),
  foreign key (organization_id, job_id) references app.notification_jobs (organization_id, id)
);
alter table app.notification_send_evidence enable row level security;
revoke all on app.notification_send_evidence from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Early provider callbacks: held privately until the acceptance that correlates them
-- ---------------------------------------------------------------------------

-- A signed callback can arrive before the send result that records its provider message id. It
-- names no organization, so it is held here — never in tenant tables — and applied to the message
-- whose acceptance later records that id. Bounded: 48 hours, 20 per provider message, 10,000 in
-- all, and payloads over 16 KB are not kept.
create table app.email_early_events (
  provider_event_id text primary key check (length(provider_event_id) between 1 and 200),
  provider_message_id text not null check (length(provider_message_id) between 1 and 200),
  event_type text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  event_at timestamptz,
  received_at timestamptz not null default now()
);
create index email_early_events_message on app.email_early_events (provider_message_id, received_at);
create index email_early_events_received on app.email_early_events (received_at);
alter table app.email_early_events enable row level security;
revoke all on app.email_early_events from public, anon, authenticated;

-- Acceptance and callbacks for one provider message id run one at a time, so a callback is either
-- applied or held for that acceptance to apply — never neither.
create function app.email_provider_lock(p_provider_message_id text) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('email-provider-message:' || p_provider_message_id, 0)
$$;
revoke all on function app.email_provider_lock(text) from public, anon, authenticated;

-- One delivery event applied to one known message: the body `record_email_event` always had, now
-- shared with the replay of early callbacks so both take the same canonical path.
create function app.apply_email_event(
  p_organization_id uuid, p_message_id uuid, p_event_type text, p_provider_event_id text,
  p_detail text, p_payload jsonb, p_event_at timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_event uuid; v_status text;
begin
  -- Only these move the canonical status; a delay, an open, a click and a complaint are history.
  v_status := case p_event_type when 'sent' then 'sent' when 'delivered' then 'delivered'
                                when 'bounced' then 'bounced' when 'failed' then 'failed' when 'rejected' then 'rejected' end;

  insert into public.message_events (organization_id, message_id, event_type, status_after, provider_event_id, provider_event_at, detail, payload)
    values (p_organization_id, p_message_id, p_event_type, v_status, p_provider_event_id, p_event_at, left(p_detail, 500), coalesce(p_payload, '{}'::jsonb))
    on conflict (organization_id, provider_event_id) where provider_event_id is not null do nothing
    returning id into v_event;
  -- A retried callback is the same fact: no second event, no second transition, no second bill.
  if v_event is null then return null; end if;

  if v_status is not null and app.advance_email_status(p_organization_id, p_message_id, v_status, p_detail) then
    if v_status in ('delivered', 'bounced', 'failed', 'rejected') then
      insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (p_organization_id, '00000000-0000-4000-8000-0000000000a7', 'message', p_message_id,
                case v_status when 'delivered' then 'email.delivered' else 'email.' || v_status end,
                jsonb_build_object('channel', 'email'));
    end if;
  end if;
  return v_event;
end $$;
revoke all on function app.apply_email_event(uuid, uuid, text, text, text, jsonb, timestamptz) from public, anon, authenticated;

create function app.hold_early_email_event(
  p_provider_message_id text, p_event_type text, p_provider_event_id text,
  p_detail text, p_payload jsonb, p_event_at timestamptz
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from app.email_early_events where received_at < now() - interval '48 hours';
  if (select count(*) from app.email_early_events where provider_message_id = p_provider_message_id) >= 20
     or (select count(*) from app.email_early_events) >= 10000 then
    return;
  end if;
  insert into app.email_early_events (provider_event_id, provider_message_id, event_type, detail, payload, event_at)
    values (p_provider_event_id, p_provider_message_id, p_event_type, left(p_detail, 500),
            case when octet_length(coalesce(p_payload, '{}'::jsonb)::text) <= 16384 then coalesce(p_payload, '{}'::jsonb)
                 else '{"truncated":true}'::jsonb end,
            p_event_at)
    on conflict (provider_event_id) do nothing;
end $$;
revoke all on function app.hold_early_email_event(text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;

-- Replays the held callbacks for a provider message id into the message that now owns it, in the
-- provider's own order. The canonical status rank still decides what each one changes.
create function app.apply_early_email_events(p_organization_id uuid, p_message_id uuid, p_provider_message_id text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare e app.email_early_events;
begin
  for e in select * from app.email_early_events where provider_message_id = p_provider_message_id
            order by coalesce(event_at, received_at), received_at, provider_event_id loop
    perform app.apply_email_event(p_organization_id, p_message_id, e.event_type, e.provider_event_id, e.detail, e.payload, e.event_at);
  end loop;
  delete from app.email_early_events where provider_message_id = p_provider_message_id;
end $$;
revoke all on function app.apply_early_email_events(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.record_email_event(
  p_provider_message_id text, p_event_type text, p_provider_event_id text,
  p_detail text, p_payload jsonb, p_event_at timestamptz default null
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_message uuid;
begin
  if p_event_type not in ('sent', 'delivered', 'delayed', 'bounced', 'failed', 'rejected', 'complained', 'opened', 'clicked') then
    raise exception 'unknown email event: %', p_event_type using errcode = '22023';
  end if;
  if p_provider_event_id is null or btrim(p_provider_event_id) = '' then
    raise exception 'a provider event needs its own id' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_provider_message_id, '')), '') is null or length(p_provider_message_id) > 200 then
    return null;
  end if;

  perform pg_advisory_xact_lock(app.email_provider_lock(p_provider_message_id));
  select organization_id, id into v_org, v_message from public.messages
   where external_id = p_provider_message_id and requested_transport = 'email' and direction = 'outbound'
   limit 1;
  if v_org is null then
    -- Possibly early: kept, untenanted, for the acceptance that will name its message.
    perform app.hold_early_email_event(p_provider_message_id, p_event_type, p_provider_event_id, p_detail, p_payload, p_event_at);
    return null;
  end if;
  return app.apply_email_event(v_org, v_message, p_event_type, p_provider_event_id, p_detail, p_payload, p_event_at);
end $$;
alter function public.record_email_event(text, text, text, text, jsonb, timestamptz) set lock_timeout = '3s';

create or replace function public.record_email_send_result(
  p_organization_id uuid, p_message_id uuid, p_outcome text,
  p_external_id text default null, p_detail text default null, p_rfc_message_id text default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_external text;
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
    if nullif(btrim(coalesce(p_external_id, '')), '') is not null then
      perform pg_advisory_xact_lock(app.email_provider_lock(p_external_id));
    end if;
    update public.messages set external_id = coalesce(external_id, p_external_id)
     where organization_id = p_organization_id and id = p_message_id
     returning external_id into v_external;
    if v_external is distinct from p_external_id and v_external is not null then
      perform pg_advisory_xact_lock(app.email_provider_lock(v_external));
    end if;
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

  if p_outcome = 'accepted' and v_external is not null then
    perform app.apply_early_email_events(p_organization_id, p_message_id, v_external);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The notification worker's three doors
-- ---------------------------------------------------------------------------

-- The one place a job's outcome is written, for a current lease and for a claim settling earlier
-- evidence alike. `held` leaves the message as in flight: it is neither sent nor failed.
create function app.settle_customer_notification(j app.notification_jobs, p_result text, p_external_id text, p_detail text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_detail text;
begin
  v_detail := coalesce(p_detail, case p_result
    when 'retry' then 'Email provider temporarily unavailable'
    when 'failed' then 'Email delivery failed; inspect delivery attempts'
    when 'rejected' then 'Email provider refused this message'
    when 'held' then 'Delivery uncertain: an earlier attempt may have reached the provider; reconcile with the provider before any retry' end);
  if p_result = 'held' then
    update public.messages set status = 'sending'
     where organization_id = j.organization_id and id = j.message_id and status = 'queued';
  else
    perform public.record_email_send_result(j.organization_id, j.message_id, p_result, p_external_id, v_detail, null);
  end if;
  update app.notification_jobs
     set state = case p_result when 'accepted' then 'accepted' when 'retry' then 'queued' when 'held' then 'held' else 'failed' end,
         reason = v_detail, lease_until = null,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * (2 ^ j.attempts)::integer))
   where organization_id = j.organization_id and id = j.id;
  if p_result in ('failed', 'rejected') then
    update public.service_notification_intents set state = 'failed', reason = v_detail
     where organization_id = j.organization_id and id = j.intent_id;
  end if;
  if p_result in ('accepted', 'rejected') then
    update app.notification_send_evidence set reconciled_at = now()
     where organization_id = j.organization_id and job_id = j.id and reconciled_at is null;
  end if;
  return v_detail;
end $$;
revoke all on function app.settle_customer_notification(app.notification_jobs, text, text, text) from public, anon, authenticated;

create or replace function public.claim_customer_notification(p_job_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j app.notification_jobs; i public.service_notification_intents; c app.notification_challenges;
  v_reason text; v_detail text; details public.email_message_details; evidence app.notification_send_evidence;
  v_key text; v_account uuid; v_binding uuid;
begin
  select * into j from app.notification_jobs
   where (p_job_id is null or id = p_job_id)
     and ((state = 'queued' and next_attempt_at <= now()) or (state = 'sending' and lease_until < now()))
   order by next_attempt_at for update skip locked limit 1;
  if not found then return null; end if;
  if j.state = 'sending' then
    update public.service_notification_attempts set finished_at = now(), outcome = 'lease_expired'
     where organization_id = j.organization_id and id = j.lease_id and finished_at is null;
  end if;

  -- A definitive provider answer that arrived after its lease ended settles the job: sending it
  -- again would be a second message, not a retry.
  select * into evidence from app.notification_send_evidence
   where organization_id = j.organization_id and job_id = j.id and reconciled_at is null
   order by outcome = 'accepted' desc, recorded_at limit 1;
  if found then
    perform app.settle_customer_notification(j, evidence.outcome, evidence.external_id);
    return jsonb_build_object('held', true, 'reconciled', true);
  end if;

  if j.attempts >= 5 or j.first_attempt_at < now() - interval '23 hours' then
    if j.dispatched_at is not null then
      perform app.settle_customer_notification(j, 'held', null,
        'Delivery uncertain: an earlier attempt may have reached the provider and its retry window or attempt limit has ended; reconcile with the provider before any retry');
      return jsonb_build_object('held', true);
    end if;
    v_reason := 'Retry limit reached; provider idempotency window must not be exceeded';
  elsif j.intent_id is not null then
    select * into i from public.service_notification_intents where organization_id = j.organization_id and id = j.intent_id;
    v_reason := app.notification_ineligibility(i);
  else
    select * into c from app.notification_challenges where organization_id = j.organization_id and id = j.challenge_id;
    if c.expires_at <= now() or c.confirmed_at is not null then v_reason := 'Confirmation expired or already used'; end if;
    if app.notification_suppressed(j.organization_id, c.email_address) then v_reason := 'Communications has suppressed this recipient address'; end if;
  end if;
  if not app.email_identity_ready(j.organization_id, j.email_identity_id) then v_reason := 'Email identity is not ready; configure Communications'; end if;
  if v_reason is not null then
    update app.notification_jobs
       set state = case when j.attempts >= 5 or j.first_attempt_at < now() - interval '23 hours' or v_reason like 'Email identity%' then 'failed' else 'suppressed' end,
           reason = v_reason, lease_until = null
     where organization_id = j.organization_id and id = j.id;
    update public.service_notification_intents
       set state = case when j.attempts >= 5 or j.first_attempt_at < now() - interval '23 hours' or v_reason like 'Email identity%' then 'failed' else 'suppressed' end,
           reason = v_reason
     where organization_id = j.organization_id and id = j.intent_id;
    -- A message an earlier attempt may have sent is never declared failed; it stays in flight.
    update public.messages set status = case when j.dispatched_at is null then 'failed' else 'sending' end,
                               failure_reason = case when j.dispatched_at is null then v_reason else failure_reason end
     where organization_id = j.organization_id and id = j.message_id and status in ('queued', 'sending');
    return jsonb_build_object('held', true);
  end if;

  -- The provider account is fixed for the life of the job. Before any send was authorized nothing
  -- at a provider depends on it, so a changed account is taken up openly; after, a different
  -- account could not recognise the idempotency key, so the delivery is held as uncertain.
  select s.provider_key, s.provider_account_id, s.binding_id into v_key, v_account, v_binding
    from app.notification_provider_scope(j.organization_id, j.email_identity_id) s;
  if j.provider_pinned_at is not null
     and (v_key is distinct from j.provider_key or v_account is distinct from j.provider_account_id) then
    if j.dispatched_at is not null then
      perform app.settle_customer_notification(j, 'held', null,
        'Delivery uncertain: an earlier attempt may have reached the provider and the sender''s provider account has since changed; reconcile with the provider before any retry');
      return jsonb_build_object('held', true);
    end if;
    v_detail := 'Provider account changed before any send reached a provider; this attempt uses the current account';
    j.provider_pinned_at := null;
  end if;
  if j.provider_pinned_at is null then
    j.provider_key := v_key; j.provider_account_id := v_account; j.provider_binding_id := v_binding;
  end if;

  j.lease_id := gen_random_uuid();
  update app.notification_jobs
     set state = 'sending', attempts = attempts + 1, lease_id = j.lease_id, lease_until = now() + interval '5 minutes',
         first_attempt_at = coalesce(first_attempt_at, now()),
         provider_key = j.provider_key, provider_account_id = j.provider_account_id, provider_binding_id = j.provider_binding_id,
         provider_pinned_at = coalesce(j.provider_pinned_at, now())
   where organization_id = j.organization_id and id = j.id;
  update public.messages set status = 'sending' where organization_id = j.organization_id and id = j.message_id and status in ('queued', 'sending');
  if j.intent_id is not null then
    insert into public.service_notification_attempts (organization_id, id, intent_id, message_id, detail)
      values (j.organization_id, j.lease_id, j.intent_id, j.message_id, v_detail);
  end if;
  select * into details from public.email_message_details where organization_id = j.organization_id and message_id = j.message_id;
  return jsonb_build_object('job_id', j.id, 'lease_id', j.lease_id, 'organization_id', j.organization_id, 'message_id', j.message_id,
    'provider_key', j.provider_key, 'provider_account_id', j.provider_account_id,
    'from_address', details.from_address, 'from_name', details.from_name, 'to', details.to_addresses, 'subject', details.subject,
    'text', (select body from public.messages where organization_id = j.organization_id and id = j.message_id));
end $$;

create or replace function public.authorize_customer_notification_send(p_job_id uuid, p_lease_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j app.notification_jobs; i public.service_notification_intents; v_reason text; v_key text; v_account uuid;
begin
  -- The provider call and its completion must both fit inside the lease, so no send is authorized
  -- that could only be finished after another worker may have reclaimed the job.
  select * into j from app.notification_jobs
   where id = p_job_id and lease_id = p_lease_id and state = 'sending' and lease_until > now() + interval '60 seconds'
   for update;
  if not found then return false; end if;
  if j.intent_id is not null then
    select * into i from public.service_notification_intents where organization_id = j.organization_id and id = j.intent_id;
    v_reason := app.notification_ineligibility(i);
  elsif not exists (select 1 from app.notification_challenges where organization_id = j.organization_id and id = j.challenge_id and expires_at > now() and confirmed_at is null and not app.notification_suppressed(j.organization_id, email_address)) then
    v_reason := 'Confirmation expired or recipient suppressed';
  end if;
  if not app.email_identity_ready(j.organization_id, j.email_identity_id) then v_reason := 'Email identity is not ready'; end if;
  if v_reason is not null then
    update app.notification_jobs set state = case when v_reason like 'Email identity%' then 'failed' else 'suppressed' end, reason = v_reason, lease_until = null
     where organization_id = j.organization_id and id = j.id;
    update public.service_notification_intents set state = case when v_reason like 'Email identity%' then 'failed' else 'suppressed' end, reason = v_reason
     where organization_id = j.organization_id and id = j.intent_id;
    update public.messages set status = 'rejected', failure_reason = v_reason
     where organization_id = j.organization_id and id = j.message_id and status = 'sending' and j.dispatched_at is null;
    update public.service_notification_attempts set finished_at = now(), outcome = 'suppressed', detail = v_reason
     where organization_id = j.organization_id and id = j.lease_id;
    return false;
  end if;

  select s.provider_key, s.provider_account_id into v_key, v_account from app.notification_provider_scope(j.organization_id, j.email_identity_id) s;
  if v_key is distinct from j.provider_key or v_account is distinct from j.provider_account_id then
    update public.service_notification_attempts set finished_at = now(), outcome = 'provider_changed',
           detail = 'Provider account changed after this attempt was claimed; nothing was sent'
     where organization_id = j.organization_id and id = j.lease_id;
    if j.dispatched_at is not null then
      perform app.settle_customer_notification(j, 'held', null,
        'Delivery uncertain: an earlier attempt may have reached the provider and the sender''s provider account has since changed; reconcile with the provider before any retry');
    else
      update app.notification_jobs set state = 'queued', lease_until = null, next_attempt_at = now(),
             reason = 'Provider account changed; the next attempt uses the current account'
       where organization_id = j.organization_id and id = j.id;
      update public.messages set status = 'queued' where organization_id = j.organization_id and id = j.message_id and status = 'sending';
    end if;
    return false;
  end if;

  update app.notification_jobs set dispatched_at = coalesce(dispatched_at, now()) where organization_id = j.organization_id and id = j.id;
  return true;
end $$;

create or replace function public.finish_customer_notification(p_job_id uuid, p_lease_id uuid, p_outcome text, p_external_id text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j app.notification_jobs; v_result text := p_outcome; v_external text := nullif(btrim(coalesce(p_external_id, '')), ''); evidence app.notification_send_evidence; v_detail text;
begin
  if p_outcome is null or p_outcome not in ('accepted', 'retry', 'rejected', 'failed') or (p_outcome = 'accepted' and v_external is null) then
    raise exception 'Invalid notification outcome' using errcode = '22023';
  end if;
  select * into j from app.notification_jobs where id = p_job_id for update;
  if not found then return false; end if;

  -- Only the current, unexpired lease completes a job. Expiry fences completion; it is not proof
  -- that the provider did nothing, so a definitive answer from one of this job's own leases is kept
  -- for the next claim to settle instead of being lost or sent again.
  if j.lease_id is distinct from p_lease_id or j.state <> 'sending' or j.lease_until is null or j.lease_until <= now() then
    if p_outcome in ('accepted', 'rejected') and j.state in ('sending', 'queued')
       and (j.lease_id = p_lease_id or exists (select 1 from public.service_notification_attempts where organization_id = j.organization_id and id = p_lease_id and message_id = j.message_id)) then
      insert into app.notification_send_evidence (organization_id, job_id, lease_id, outcome, external_id)
        values (j.organization_id, j.id, p_lease_id, p_outcome, v_external) on conflict do nothing;
      update public.service_notification_attempts set finished_at = coalesce(finished_at, now()), outcome = 'late_' || p_outcome
       where organization_id = j.organization_id and id = p_lease_id;
    end if;
    return false;
  end if;

  -- An inconclusive answer now does not outweigh a definitive one an earlier lease recorded late.
  if v_result = 'retry' then
    select * into evidence from app.notification_send_evidence
     where organization_id = j.organization_id and job_id = j.id and reconciled_at is null
     order by outcome = 'accepted' desc, recorded_at limit 1;
    if found then v_result := evidence.outcome; v_external := evidence.external_id; end if;
  end if;
  if v_result = 'retry' and j.attempts >= 5 then
    v_result := case when j.dispatched_at is null then 'failed' else 'held' end;
  end if;
  v_detail := app.settle_customer_notification(j, v_result, v_external, case when v_result = 'held' then
    'Delivery uncertain: an earlier attempt may have reached the provider and the attempt limit has been reached; reconcile with the provider before any retry' end);
  update public.service_notification_attempts set finished_at = now(), outcome = v_result, detail = v_detail
   where organization_id = j.organization_id and id = j.lease_id;
  return true;
end $$;

-- Bounded database time for the worker: lock waits inside its doors, and every statement PostgREST
-- runs as the worker. A slow database answers with an error the worker can stop on, never a hang.
alter function public.claim_customer_notification(uuid) set lock_timeout = '3s';
alter function public.authorize_customer_notification_send(uuid, uuid) set lock_timeout = '3s';
alter function public.finish_customer_notification(uuid, uuid, text, text) set lock_timeout = '3s';
alter role customer_notification_worker set statement_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Operator history: an uncertain delivery is its own state, never "failed"
-- ---------------------------------------------------------------------------
create or replace function public.service_notification_history(p_organization_id uuid, p_customer_id uuid, p_engagement_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id, 'customer.update') then raise exception 'Customer management permission required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) into result from (
    select i.created_at, jsonb_build_object('id', i.id, 'reviewId', i.review_id, 'purpose', i.purpose, 'recipient', i.email_address, 'sender', d.from_address, 'messageId', j.message_id, 'reason', coalesce(j.reason, i.reason),
      'state', case when i.state in ('not_requested', 'suppressed') then i.state when j.state = 'held' then 'uncertain' when m.status in ('bounced', 'rejected', 'failed', 'delivered') then m.status when i.state = 'failed' then 'failed' when exists (select 1 from public.message_events where organization_id = i.organization_id and message_id = j.message_id and event_type in ('sent', 'delayed')) then (select event_type from public.message_events where organization_id = i.organization_id and message_id = j.message_id and event_type in ('sent', 'delayed') order by coalesce(provider_event_at, occurred_at) desc, occurred_at desc limit 1) when j.state = 'accepted' then 'accepted' else 'queued' end,
      'createdAt', i.created_at, 'mayRetry', app.notification_retry_eligible(i) and app.has_capability(p_organization_id, 'message.send'),
      'attempts', coalesce((select jsonb_agg(jsonb_build_object('at', started_at, 'finishedAt', finished_at, 'outcome', outcome, 'detail', detail) order by started_at) from public.service_notification_attempts where organization_id = i.organization_id and intent_id = i.id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('type', event_type, 'at', coalesce(provider_event_at, occurred_at), 'ingestedAt', occurred_at) order by occurred_at) from public.message_events where organization_id = i.organization_id and message_id = j.message_id), '[]'::jsonb)) row
    from public.service_notification_intents i
    left join app.notification_jobs j on j.organization_id = i.organization_id and j.intent_id = i.id
    left join public.messages m on m.organization_id = j.organization_id and m.id = j.message_id
    left join public.email_message_details d on d.organization_id = j.organization_id and d.message_id = j.message_id
    where i.organization_id = p_organization_id and i.customer_id = p_customer_id and i.engagement_id = p_engagement_id
    order by i.created_at desc limit 50
  ) records;
  return result;
end $$;

commit;
