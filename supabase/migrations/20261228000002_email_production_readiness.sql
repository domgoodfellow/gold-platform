-- Email production readiness (Phase 3C).
--
--   * Reply-To: a business may name one of its own addresses on a domain it has proved (DNS
--     verification) as the address replies go to. Nothing else is accepted: no typed address.
--   * Uncertain deliveries are their own state, visible to the business, never resent. A provider
--     report carrying the delivery's tag resolves one (and any delivery whose answer was lost)
--     without a second send.
--   * Test send: a manager sends one fixed test email from the business's own default sender to
--     their own confirmed sign-in address, rate limited, authorized here, sent by apps/api.
--   * Received email is read with the account recorded as holding the receiving address's domain.
--   * An invitation link can be previewed by whoever holds it (business, role, address), only
--     while it is valid; a dead link says only that it is not valid, as accepting it does.
--   * Platform staff read the facts GildOps' own email readiness is judged on.

-- --- Reply-To --------------------------------------------------------------------------------

alter table public.organization_email_sending
  add column reply_to_email_identity_id uuid,
  add constraint organization_email_sending_reply_to_fk foreign key (organization_id, reply_to_email_identity_id) references public.email_identities(organization_id, id);

-- An address on a domain this business has proved, still active. Proving the domain is what makes
-- the address the business's own; it need not be able to send, and receiving is a separate fact.
create function app.email_reply_to_eligible(org uuid, identity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.email_identities i
      join public.organization_provider_resources r on r.organization_id = i.organization_id and r.id = i.sending_domain_resource_id
     where i.organization_id = org and i.id = identity_id and i.status = 'active' and i.ownership = 'customer_domain'
       and r.resource_type = 'resend_domain' and r.status = 'active')
$$;
revoke all on function app.email_reply_to_eligible(uuid, uuid) from public, anon, authenticated;

-- The business's Reply-To at send time, or null (replies then go to the From address).
create function app.organization_reply_to(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select i.address from public.organization_email_sending s
    join public.email_identities i on i.organization_id = s.organization_id and i.id = s.reply_to_email_identity_id
   where s.organization_id = org and app.email_reply_to_eligible(org, i.id)
$$;
revoke all on function app.organization_reply_to(uuid) from public, anon, authenticated;

create function public.set_email_reply_to(p_organization_id uuid, p_email_identity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_email_sending where organization_id = p_organization_id) then
    raise exception 'Choose a default sender before choosing where replies go.' using errcode = '55000';
  end if;
  if p_email_identity_id is not null and not app.email_reply_to_eligible(p_organization_id, p_email_identity_id) then
    raise exception 'Replies can only go to one of this business''s addresses on a verified domain.' using errcode = '55000';
  end if;
  update public.organization_email_sending
     set reply_to_email_identity_id = p_email_identity_id, updated_by = auth.uid(), updated_at = now()
   where organization_id = p_organization_id;
end $$;
revoke all on function public.set_email_reply_to(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_email_reply_to(uuid, uuid) to authenticated;

-- The address list Email sending shows, now also saying which address replies go to and which
-- could take them.
drop function public.organization_email_senders(uuid);
create function public.organization_email_senders(p_organization_id uuid)
returns table (email_identity_id uuid, address text, display_name text, state text, detail text, is_default boolean, can_take_replies boolean, is_reply_to boolean, receives_in_inbox boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare i public.email_identities; v_default uuid; v_reply uuid;
begin
  if auth.uid() is null or p_organization_id not in (select app.current_tenant_ids()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select s.default_email_identity_id, s.reply_to_email_identity_id into v_default, v_reply
    from public.organization_email_sending s where s.organization_id = p_organization_id;
  for i in select * from public.email_identities e where e.organization_id = p_organization_id and e.can_send order by e.address loop
    begin
      perform 1 from app.organization_email_sender(p_organization_id, i.id);
      return query select i.id, i.address, i.display_name, 'ready'::text, null::text, i.id = v_default,
        app.email_reply_to_eligible(p_organization_id, i.id), i.id is not distinct from v_reply, i.can_receive;
    exception
      when sqlstate '55000' then return query select i.id, i.address, i.display_name, 'not_ready'::text, sqlerrm, i.id is not distinct from v_default,
        app.email_reply_to_eligible(p_organization_id, i.id), i.id is not distinct from v_reply, i.can_receive;
      when sqlstate '58000' then return query select i.id, i.address, i.display_name, 'unavailable'::text, sqlerrm, i.id is not distinct from v_default,
        app.email_reply_to_eligible(p_organization_id, i.id), i.id is not distinct from v_reply, i.can_receive;
    end;
  end loop;
end $$;
revoke all on function public.organization_email_senders(uuid) from public, anon, authenticated;
grant execute on function public.organization_email_senders(uuid) to authenticated;

-- --- Uncertain deliveries ----------------------------------------------------------------------

alter table public.message_deliveries
  add column reply_to text,
  drop constraint message_deliveries_state_check,
  add constraint message_deliveries_state_check check (state = any (array['queued', 'sending', 'sent', 'failed', 'uncertain'])),
  drop constraint message_deliveries_detail_matches_state,
  add constraint message_deliveries_detail_matches_state check ((state in ('failed', 'uncertain')) = (detail is not null));
update public.message_deliveries set state = 'uncertain' where state = 'failed' and detail like 'Delivery uncertain:%';

-- As before, plus: uncertainty is its own state rather than a failure, and the Reply-To is fixed
-- at the first attempt with the From, so every retry is the same request.
drop function public.claim_message_deliveries(integer);
create function public.claim_message_deliveries(p_limit integer default 50)
returns table (id uuid, channel text, recipient text, subject_line text, body text, from_address text, from_name text, reply_to text, provider_key text, provider_account_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare d public.message_deliveries; s record; v_from text; v_name text; v_reply text;
begin
  for d in
    select * from public.message_deliveries m
     where m.state = 'queued' or (m.state = 'sending' and m.claimed_at < now() - interval '10 minutes')
     order by m.queued_at
     limit least(greatest(p_limit, 1), 200)
     for update skip locked
  loop
    if (d.state = 'sending' and d.channel <> 'email')
       or (d.attempts > 0 and d.first_attempt_at < now() - interval '23 hours') then
      update public.message_deliveries m set state = 'uncertain', claimed_at = null,
             detail = 'Delivery uncertain: an earlier sending attempt may have reached the provider, and it can no longer be retried safely. Check with the recipient before sending again.'
       where m.id = d.id;
      continue;
    end if;
    if d.channel = 'email' then
      begin
        select * into s from app.organization_email_sender(d.organization_id, d.email_identity_id);
      exception
        when sqlstate '55000' or sqlstate '42501' then
          update public.message_deliveries m set state = 'failed', claimed_at = null, detail = sqlerrm where m.id = d.id;
          continue;
        when sqlstate '58000' then
          if d.state = 'sending' then update public.message_deliveries m set state = 'queued', claimed_at = null where m.id = d.id; end if;
          continue;
      end;
      update public.message_deliveries m
         set state = 'sending', claimed_at = now(), email_identity_id = s.email_identity_id,
             from_address = coalesce(m.from_address, s.from_address),
             from_name = case when m.from_address is null then s.from_name else m.from_name end,
             reply_to = case when m.attempts = 0 then app.organization_reply_to(d.organization_id) else m.reply_to end,
             attempts = m.attempts + 1, first_attempt_at = coalesce(m.first_attempt_at, now())
       where m.id = d.id
       returning m.from_address, m.from_name, m.reply_to into v_from, v_name, v_reply;
      return query select d.id, d.channel, d.recipient, d.subject_line, d.body, v_from, v_name, v_reply, s.provider_key, s.provider_account_id;
    else
      update public.message_deliveries m
         set state = 'sending', claimed_at = now(), attempts = m.attempts + 1, first_attempt_at = coalesce(m.first_attempt_at, now())
       where m.id = d.id;
      return query select d.id, d.channel, d.recipient, d.subject_line, d.body, null::text, null::text, null::text, null::text, null::uuid;
    end if;
  end loop;
end $$;
revoke all on function public.claim_message_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_message_deliveries(integer) to automation_runner;

create or replace function public.finish_message_delivery(p_id uuid, p_outcome text, p_external_id text default null, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_external text := nullif(btrim(p_external_id), ''); e record;
begin
  if p_outcome not in ('accepted', 'rejected', 'failed', 'retry', 'uncertain') then
    raise exception 'unknown delivery outcome' using errcode = '22023';
  end if;
  update public.message_deliveries
     set state = case p_outcome when 'accepted' then 'sent' when 'retry' then 'queued' when 'uncertain' then 'uncertain' else 'failed' end,
         sent_at = case when p_outcome = 'accepted' then now() end,
         external_id = case when p_outcome = 'accepted' then v_external end,
         detail = case
                    when p_outcome = 'uncertain' then 'Delivery uncertain: ' || coalesce(nullif(btrim(p_detail), ''), 'the provider could not confirm whether it was sent') || '. Check with the recipient before sending again.'
                    when p_outcome in ('rejected', 'failed') then coalesce(nullif(btrim(p_detail), ''), 'the provider did not say why')
                  end,
         claimed_at = null
   where id = p_id and state = 'sending';
  if p_outcome = 'accepted' and v_external is not null then
    for e in select * from app.email_early_events where provider_message_id = v_external order by coalesce(event_at, received_at) loop
      perform app.apply_delivery_report(p_id, e.event_type, e.detail, e.event_at);
    end loop;
    delete from app.email_early_events where provider_message_id = v_external;
  end if;
end $$;

-- A provider report names the delivery it is about by the tag apps/api sent with it. When that
-- delivery never recorded the provider's answer (an attempt in flight, returned to the queue, or
-- uncertain), the report is proof the provider took it: it is recorded as sent, with the
-- provider's id, so it is never sent again.
create function app.email_event_tag(payload jsonb, tag text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(payload #>> array['data', 'tags', tag], ''),
    (select t ->> 'value' from jsonb_array_elements(case when jsonb_typeof(payload #> '{data,tags}') = 'array' then payload #> '{data,tags}' else '[]'::jsonb end) t where t ->> 'name' = tag limit 1)
  )
$$;
revoke all on function app.email_event_tag(jsonb, text) from public, anon, authenticated;

create function app.resolve_delivery_by_tag(p_provider_message_id text, p_event_type text, p_detail text, p_payload jsonb, p_event_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_tag text := app.email_event_tag(p_payload, 'gildops_delivery'); v_id uuid; v_test uuid;
begin
  if p_event_type in ('opened', 'clicked') then return false; end if;
  if v_tag ~ '^[0-9a-f-]{36}$' then
    update public.message_deliveries m
       set state = 'sent', sent_at = coalesce(m.sent_at, coalesce(p_event_at, now())), external_id = p_provider_message_id, detail = null, claimed_at = null
     where m.id = v_tag::uuid and m.external_id is null and m.state in ('queued', 'sending', 'uncertain')
     returning m.id into v_id;
    if v_id is null then
      select m.id into v_id from public.message_deliveries m where m.id = v_tag::uuid and m.external_id = p_provider_message_id;
    end if;
    if v_id is not null then
      perform app.apply_delivery_report(v_id, p_event_type, p_detail, p_event_at);
      return true;
    end if;
  end if;
  v_tag := app.email_event_tag(p_payload, 'gildops_test_send');
  if v_tag ~ '^[0-9a-f-]{36}$' or exists (select 1 from public.email_test_sends where external_id = p_provider_message_id) then
    update public.email_test_sends t
       set external_id = coalesce(t.external_id, p_provider_message_id),
           state = case when t.state in ('sending', 'uncertain') then 'sent' else t.state end,
           provider_state = case when p_event_type in ('delivered', 'delayed', 'bounced', 'complained', 'failed', 'rejected')
                                  and not (p_event_type = 'delayed' and t.provider_state is not null and t.provider_state <> 'delayed')
                                 then p_event_type else t.provider_state end,
           provider_state_at = case when p_event_type in ('delivered', 'delayed', 'bounced', 'complained', 'failed', 'rejected') then coalesce(p_event_at, now()) else t.provider_state_at end
     where (t.id = case when v_tag ~ '^[0-9a-f-]{36}$' then v_tag::uuid end or t.external_id = p_provider_message_id)
     returning t.id into v_test;
    return v_test is not null;
  end if;
  return false;
end $$;
revoke all on function app.resolve_delivery_by_tag(text, text, text, jsonb, timestamptz) from public, anon, authenticated;

-- --- Test send ---------------------------------------------------------------------------------

create table public.email_test_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  recipient text not null,
  email_identity_id uuid not null,
  from_address text not null,
  from_name text,
  reply_to text,
  state text not null default 'sending' check (state in ('sending', 'sent', 'failed', 'uncertain')),
  external_id text check (external_id is null or length(external_id) between 1 and 200),
  detail text check (detail is null or length(detail) <= 500),
  provider_state text check (provider_state is null or provider_state = any (array['delivered', 'delayed', 'bounced', 'complained', 'failed', 'rejected'])),
  provider_state_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (organization_id, email_identity_id) references public.email_identities(organization_id, id),
  unique (organization_id, id)
);
create index email_test_sends_org_created on public.email_test_sends (organization_id, created_at desc);
create index email_test_sends_external on public.email_test_sends (external_id) where external_id is not null;
alter table public.email_test_sends enable row level security;
alter table public.email_test_sends force row level security;
revoke all on public.email_test_sends from public, anon, authenticated;
grant select on public.email_test_sends to authenticated;
create policy email_test_sends_read on public.email_test_sends for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'organization.manage'));

-- Under the manager's own session: who may ask, to whom it goes, from which address, how often.
-- The recipient is always the caller's own confirmed sign-in address; there is no other.
create function public.begin_email_test_send(p_organization_id uuid)
returns table (id uuid, recipient text, from_address text, from_name text, reply_to text, business_name text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_actor uuid := auth.uid(); v_email text; s record; v_id uuid; v_business text;
begin
  if v_actor is null or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false);
  if v_email is null then
    raise exception 'Confirm your own sign-in email address before sending a test.' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 3301));
  -- An attempt nobody finished within ten minutes is uncertain, not still sending.
  update public.email_test_sends t set state = 'uncertain', detail = 'The test was interrupted; it may or may not have been sent.', finished_at = now()
   where t.organization_id = p_organization_id and t.state = 'sending' and t.created_at < now() - interval '10 minutes';
  if (select count(*) from public.email_test_sends t where t.organization_id = p_organization_id and t.created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.email_test_sends t where t.organization_id = p_organization_id and t.created_at > now() - interval '1 day') >= 10
     or (select count(*) from public.email_test_sends t where t.requested_by = v_actor and t.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many test emails for now. Try again later.' using errcode = '53400';
  end if;
  select * into s from app.organization_email_sender(p_organization_id);
  select o.name into v_business from public.organizations o where o.id = p_organization_id;
  insert into public.email_test_sends (organization_id, requested_by, recipient, email_identity_id, from_address, from_name, reply_to)
    values (p_organization_id, v_actor, v_email, s.email_identity_id, s.from_address, s.from_name, app.organization_reply_to(p_organization_id))
    returning email_test_sends.id into v_id;
  return query select t.id, t.recipient, t.from_address, t.from_name, t.reply_to, v_business from public.email_test_sends t where t.id = v_id;
end $$;
revoke all on function public.begin_email_test_send(uuid) from public, anon, authenticated;
grant execute on function public.begin_email_test_send(uuid) to authenticated;

-- For apps/api only: which recorded account sends this test, resolved again now.
create function public.email_test_send_account(p_organization_id uuid, p_id uuid)
returns table (provider_key text, provider_account_id uuid, state text, detail text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare t public.email_test_sends; s record;
begin
  select * into t from public.email_test_sends x where x.organization_id = p_organization_id and x.id = p_id and x.state = 'sending';
  if not found then
    return query select null::text, null::uuid, 'refused'::text, 'No such test email.'::text;
    return;
  end if;
  select * into s from app.organization_email_sender(p_organization_id, t.email_identity_id);
  return query select s.provider_key, s.provider_account_id, 'ready'::text, null::text;
exception
  when sqlstate '55000' or sqlstate '42501' then return query select null::text, null::uuid, 'refused'::text, sqlerrm;
  when sqlstate '58000' then return query select null::text, null::uuid, 'unavailable'::text, sqlerrm;
end $$;
revoke all on function public.email_test_send_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_test_send_account(uuid, uuid) to provider_operator;

create function public.finish_email_test_send(p_organization_id uuid, p_id uuid, p_outcome text, p_external_id text default null, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('accepted', 'rejected', 'failed', 'uncertain') then
    raise exception 'unknown test outcome' using errcode = '22023';
  end if;
  update public.email_test_sends
     set state = case p_outcome when 'accepted' then 'sent' when 'uncertain' then 'uncertain' else 'failed' end,
         external_id = case when p_outcome = 'accepted' then nullif(btrim(p_external_id), '') else external_id end,
         detail = case when p_outcome = 'accepted' then null else left(coalesce(nullif(btrim(p_detail), ''), 'the provider did not say why'), 500) end,
         finished_at = now()
   where organization_id = p_organization_id and id = p_id and state = 'sending';
end $$;
revoke all on function public.finish_email_test_send(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_email_test_send(uuid, uuid, text, text, text) to provider_operator;

-- --- Received email ----------------------------------------------------------------------------

-- Which account may read a received message: the one recorded as holding the domain of the
-- address it was sent to. `unknown` (nobody here receives at that address) and `ambiguous` are
-- ignored by the caller; `unrecorded`/`unavailable` are retried, never read through another account.
create function public.email_receiving_account(p_to_addresses text[])
returns table (state text, provider_account_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_orgs integer; v_bindings integer; v_account uuid; v_recorded uuid;
begin
  select count(distinct i.organization_id), count(distinct r.binding_id), min(b.provider_account_id::text)::uuid
    into v_orgs, v_bindings, v_recorded
    from public.email_identities i
    join public.organization_provider_resources r on r.organization_id = i.organization_id and r.id = i.sending_domain_resource_id
    join public.organization_provider_bindings b on b.organization_id = r.organization_id and b.id = r.binding_id
   where i.can_receive and i.status = 'active' and i.ownership = 'customer_domain'
     and i.address = any (select lower(btrim(a)) from unnest(coalesce(p_to_addresses, '{}')) a);
  if v_orgs = 0 then return query select 'unknown'::text, null::uuid; return; end if;
  if v_orgs > 1 or v_bindings > 1 then return query select 'ambiguous'::text, null::uuid; return; end if;
  if v_recorded is null then return query select 'unrecorded'::text, null::uuid; return; end if;
  select a.id into v_account from public.platform_provider_accounts a where a.id = v_recorded and a.status = 'active';
  if v_account is null then return query select 'unavailable'::text, null::uuid; return; end if;
  return query select 'ready'::text, v_account;
end $$;
revoke all on function public.email_receiving_account(text[]) from public, anon, authenticated;
grant execute on function public.email_receiving_account(text[]) to provider_operator;

-- --- Invitation preview ------------------------------------------------------------------------

-- Whoever holds a valid link may see what it is for: the business, the role and the address it
-- was sent to (which the email already told them). Anything else — unknown, revoked, expired or
-- used — answers only `invalid`, exactly as accepting it would, so a dead link reveals nothing.
create function public.invitation_preview(p_token text)
returns table (state text, business_name text, role_name text, email text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_invite public.organization_invitations;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  select * into v_invite from public.organization_invitations i
   where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_invite.id is null or v_invite.revoked_at is not null or v_invite.accepted_at is not null or v_invite.expires_at <= now() then
    return query select 'invalid'::text, null::text, null::text, null::text, null::timestamptz; return;
  end if;
  return query select 'valid'::text, o.name, r.name, v_invite.email, v_invite.expires_at
    from public.organizations o join public.roles r on r.organization_id = o.id and r.id = v_invite.role_id
   where o.id = v_invite.organization_id;
end $$;
revoke all on function public.invitation_preview(text) from public, anon, authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- --- GildOps' own email readiness --------------------------------------------------------------

-- The database half of what Platform → Providers reports: GildOps' default Resend account and
-- whether it holds a credential, and the newest invitation delivery facts. Staff only; never a
-- credential or an address.
create function public.platform_email_readiness_facts()
returns table (account_id uuid, account_status text, credential_set boolean, last_delivered_at timestamptz, last_accepted_at timestamptz, last_failed_at timestamptz, last_failure text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not app.has_platform_capability('platform.providers') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
  select a.id, a.status, a.credential_set_at is not null,
         (select max(d.occurred_at) from public.invitation_deliveries d where d.state = 'delivered'),
         (select max(d.occurred_at) from public.invitation_deliveries d where d.state in ('queued', 'sent', 'delivered')),
         (select max(d.occurred_at) from public.invitation_deliveries d where d.state in ('failed', 'bounced', 'suppressed')),
         (select d.detail from public.invitation_deliveries d where d.state in ('failed', 'bounced', 'suppressed') order by d.occurred_at desc limit 1)
    from (select 1) one
    left join public.platform_provider_accounts a on a.provider_key = 'resend' and a.is_default;
end $$;
revoke all on function public.platform_email_readiness_facts() from public, anon, authenticated;
grant execute on function public.platform_email_readiness_facts() to authenticated;

-- The functions below are their current definitions with one change each, marked "Changed (Phase 3C)".

CREATE OR REPLACE FUNCTION public.record_email_event(p_provider_message_id text, p_event_type text, p_provider_event_id text, p_detail text, p_payload jsonb, p_event_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
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
    -- Changed (Phase 3B): an automation delivery the provider accepted is matched here too, and
    -- its report recorded on it; nothing else about the delivery changes.
    select d.id into v_message from public.message_deliveries d where d.external_id = p_provider_message_id limit 1;
    if v_message is not null then
      perform app.apply_delivery_report(v_message, p_event_type, p_detail, p_event_at);
      return null;
    end if;
    -- Changed (Phase 3C): a delivery whose provider answer was never recorded is found by its tag,
    -- recorded as sent, and so never sent again.
    if app.resolve_delivery_by_tag(p_provider_message_id, p_event_type, p_detail, p_payload, p_event_at) then
      return null;
    end if;
    -- Possibly early: kept, untenanted, for the acceptance that will name its message.
    perform app.hold_early_email_event(p_provider_message_id, p_event_type, p_provider_event_id, p_detail, p_payload, p_event_at);
    return null;
  end if;
  return app.apply_email_event(v_org, v_message, p_event_type, p_provider_event_id, p_detail, p_payload, p_event_at);
end $function$;

CREATE OR REPLACE FUNCTION public.claim_customer_notification(p_job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
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
    'from_address', details.from_address, 'from_name', details.from_name, 'reply_to', app.organization_reply_to(j.organization_id), /* Changed (Phase 3C): the business's Reply-To */ 'to', details.to_addresses, 'subject', details.subject,
    'text', (select body from public.messages where organization_id = j.organization_id and id = j.message_id));
end $function$;
