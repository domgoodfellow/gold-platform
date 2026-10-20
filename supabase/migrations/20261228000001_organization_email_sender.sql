-- One organization sender for every email a business sends (Phase 3A/3B).
--
-- **Credentials are not identity.** GildOps holds the Resend account; a business owns the
-- addresses it has proved. Until now automation messages (including booking confirmations) went
-- out from one installation-wide address, and service notifications needed a sender chosen on each
-- customer record. This migration gives a business one default sender, resolves every
-- business-originated email through `app.organization_email_sender`, and never substitutes the
-- platform's own address or credentials for a business's.
--
--   * `organization_email_sending`: the business's default sender, pointing at one of its own
--     email identities. Not a second identity store: addresses stay in `email_identities`.
--   * `app.organization_email_sender(org, preferred)`: the one resolution path. An explicit
--     sender (a customer's override, or the address a queued message is pinned to) must belong to
--     this business and be ready; otherwise the default is used; otherwise it refuses, saying what
--     to fix. It names the provider account recorded as holding the address's sending domain, and
--     refuses when none is recorded rather than guessing one.
--   * Domain setup now records which provider account created or confirmed a domain
--     (`record_email_domain_provisioning(..., p_provider_account_id)`), so that provenance exists.
--   * Automation messages are pinned to a resolved sender when queued, claimed once before
--     sending, sent with the delivery id as the provider's idempotency key and the same From on
--     every attempt, and recorded as accepted, refused, returned to the queue or uncertain. Once
--     the provider's day-long duplicate protection has lapsed for a delivery that was already
--     attempted, it is never sent again. Provider delivery reports are matched to it.
--   * `queued_messages` and `record_message_delivery` stay, for the runtime being replaced, but
--     now hand out text messages only: business email waits for the runtime that sends it from the
--     business's own sender. A later migration removes them once nothing calls them.
--   * Service notifications use a customer's chosen sender, else the business default.

create table public.organization_email_sending (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_email_identity_id uuid not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, default_email_identity_id) references public.email_identities(organization_id, id)
);

alter table public.organization_email_sending enable row level security;
alter table public.organization_email_sending force row level security;
revoke all on public.organization_email_sending from public, anon, authenticated;
grant select on public.organization_email_sending to authenticated;
create policy organization_email_sending_read on public.organization_email_sending for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- The one resolution path. Raises with a sentence, and the code says whose problem it is: 55000
-- (the business must finish its sender setup), 42501 (not this business's address), 58000 (the
-- platform's provider account is unavailable, which the business cannot fix and a retry may).
-- Callers decide whether that refuses a send, fails a delivery or records a failed automation run.
create function app.organization_email_sender(org uuid, preferred uuid default null)
returns table (email_identity_id uuid, from_address text, from_name text, provider_key text, provider_account_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid := preferred;
  v_identity public.email_identities;
  v_binding public.organization_provider_bindings;
  v_account uuid;
begin
  if v_id is null then
    select s.default_email_identity_id into v_id from public.organization_email_sending s where s.organization_id = org;
    if v_id is null then
      raise exception 'This business has no default sender address. Choose a verified address in Email sending settings.' using errcode = '55000';
    end if;
  end if;

  select * into v_identity from public.email_identities i where i.organization_id = org and i.id = v_id;
  if not found then
    raise exception 'That sender address does not belong to this business.' using errcode = '42501';
  end if;
  -- Only an address on the business's own verified sending domain can be sent through the
  -- platform's provider; a connected mailbox has its own provider and no sender here yet.
  if v_identity.ownership <> 'customer_domain' or not app.email_identity_ready(org, v_identity.id) then
    raise exception 'The sender address % is not verified for sending. Finish its domain setup in Email sending settings.', v_identity.address using errcode = '55000';
  end if;

  select b.* into v_binding
    from public.organization_provider_resources r
    join public.organization_provider_bindings b on b.organization_id = r.organization_id and b.id = r.binding_id
   where r.organization_id = org and r.id = v_identity.sending_domain_resource_id;
  if not found then
    raise exception 'The sender address % has no sending domain.', v_identity.address using errcode = '55000';
  end if;

  -- Only the account recorded as holding the domain. A domain whose account was never recorded
  -- is not sent from through whichever account happens to be the default today: checking the
  -- domain again confirms it with the provider and records the account that answered.
  if v_binding.provider_account_id is null then
    raise exception 'GildOps has not yet confirmed which email account holds the domain for %. Check the domain again in Email sending settings.', v_identity.address using errcode = '55000';
  end if;
  select a.id into v_account from public.platform_provider_accounts a
   where a.id = v_binding.provider_account_id and a.status = 'active';
  if v_account is null then
    raise exception 'Email sending for % is unavailable on this platform right now.', v_identity.address using errcode = '58000';
  end if;

  return query select v_identity.id, v_identity.address, v_identity.display_name, v_binding.provider_key, v_account;
end $$;
revoke all on function app.organization_email_sender(uuid, uuid) from public, anon, authenticated;

-- A customer's own notification sender where one was chosen, else the business default. The
-- callers still check readiness, as they did.
create function app.customer_email_sender(org uuid, customer uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.email_identity_id from public.customer_notification_settings c where c.organization_id = org and c.customer_id = customer),
    (select s.default_email_identity_id from public.organization_email_sending s where s.organization_id = org)
  )
$$;
revoke all on function app.customer_email_sender(uuid, uuid) from public, anon, authenticated;

-- Choosing the default sender: organization configuration, and only a ready address of this
-- business's. `null` clears it, after which business email that needs it is refused, not rerouted.
create function public.set_default_email_sender(p_organization_id uuid, p_email_identity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_email_identity_id is null then
    delete from public.organization_email_sending where organization_id = p_organization_id;
    return;
  end if;
  perform 1 from app.organization_email_sender(p_organization_id, p_email_identity_id);
  insert into public.organization_email_sending (organization_id, default_email_identity_id, updated_by)
    values (p_organization_id, p_email_identity_id, auth.uid())
    on conflict (organization_id) do update
      set default_email_identity_id = excluded.default_email_identity_id, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.set_default_email_sender(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_email_sender(uuid, uuid) to authenticated;

-- What a member is told about the default sender, without any provider detail.
create function public.organization_email_sender_status(p_organization_id uuid)
returns table (email_identity_id uuid, address text, state text, detail text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_id uuid; v_address text;
begin
  if auth.uid() is null or p_organization_id not in (select app.current_tenant_ids()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select s.default_email_identity_id, i.address into v_id, v_address
    from public.organization_email_sending s
    join public.email_identities i on i.organization_id = s.organization_id and i.id = s.default_email_identity_id
   where s.organization_id = p_organization_id;
  if v_id is null then
    return query select null::uuid, null::text, 'missing'::text, 'This business has no default sender address.'::text;
    return;
  end if;
  begin
    perform 1 from app.organization_email_sender(p_organization_id, v_id);
    return query select v_id, v_address, 'ready'::text, null::text;
  exception
    when sqlstate '55000' then return query select v_id, v_address, 'not_ready'::text, sqlerrm;
    when sqlstate '58000' then return query select v_id, v_address, 'unavailable'::text, sqlerrm;
  end;
end $$;
revoke all on function public.organization_email_sender_status(uuid) from public, anon, authenticated;
grant execute on function public.organization_email_sender_status(uuid) to authenticated;

-- Every address this business could send from, each answered by the same resolution a send uses,
-- so what Email sending settings shows is exactly what would happen. Members read their own
-- business only, and never any provider detail.
create function public.organization_email_senders(p_organization_id uuid)
returns table (email_identity_id uuid, address text, display_name text, state text, detail text, is_default boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare i public.email_identities; v_default uuid;
begin
  if auth.uid() is null or p_organization_id not in (select app.current_tenant_ids()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  select s.default_email_identity_id into v_default from public.organization_email_sending s where s.organization_id = p_organization_id;
  for i in select * from public.email_identities e where e.organization_id = p_organization_id and e.can_send order by e.address loop
    begin
      perform 1 from app.organization_email_sender(p_organization_id, i.id);
      return query select i.id, i.address, i.display_name, 'ready'::text, null::text, i.id = v_default;
    exception
      when sqlstate '55000' then return query select i.id, i.address, i.display_name, 'not_ready'::text, sqlerrm, i.id is not distinct from v_default;
      when sqlstate '58000' then return query select i.id, i.address, i.display_name, 'unavailable'::text, sqlerrm, i.id is not distinct from v_default;
    end;
  end loop;
end $$;
revoke all on function public.organization_email_senders(uuid) from public, anon, authenticated;
grant execute on function public.organization_email_senders(uuid) to authenticated;

-- A business that already has exactly one address that resolves completely — ready, on its own
-- verified domain, with the account that holds the domain recorded — sends from it rather than
-- having its automation email stop. Nothing is guessed: any other business chooses in settings.
do $$
declare r record;
begin
  for r in
    select i.organization_id, (array_agg(i.id))[1] as identity_id
      from public.email_identities i
     where i.ownership = 'customer_domain' and app.email_identity_ready(i.organization_id, i.id)
     group by i.organization_id
    having count(*) = 1
  loop
    begin
      perform 1 from app.organization_email_sender(r.organization_id, r.identity_id);
      insert into public.organization_email_sending (organization_id, default_email_identity_id) values (r.organization_id, r.identity_id);
    exception when sqlstate '55000' or sqlstate '58000' then
      null;
    end;
  end loop;
end $$;

-- The provider runtime's view of the same resolution, for an email already pinned to an address
-- (an Inbox message). It answers rather than raises, so no argument is ever echoed in an error.
create function public.email_sender_account(p_organization_id uuid, p_email_identity_id uuid)
returns table (provider_key text, provider_account_id uuid, state text, detail text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare s record;
begin
  if p_email_identity_id is null then
    return query select null::text, null::uuid, 'refused'::text, 'This email has no sender address.'::text;
    return;
  end if;
  select * into s from app.organization_email_sender(p_organization_id, p_email_identity_id);
  return query select s.provider_key, s.provider_account_id, 'ready'::text, null::text;
exception
  when sqlstate '55000' or sqlstate '42501' then return query select null::text, null::uuid, 'refused'::text, sqlerrm;
  when sqlstate '58000' then return query select null::text, null::uuid, 'unavailable'::text, sqlerrm;
end $$;
revoke all on function public.email_sender_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_sender_account(uuid, uuid) to provider_operator;

-- Domain setup records which account created or confirmed a domain. Only ever fills an empty
-- binding: a domain cannot be confirmed through one account while its binding names another.
drop function public.record_email_domain_provisioning(uuid, uuid, text, text, text, jsonb, text, text);
create function public.record_email_domain_provisioning(
  p_organization_id uuid, p_resource_id uuid, p_status text, p_provider_domain_id text default null,
  p_provider_status text default null, p_dns_records jsonb default null, p_error_code text default null,
  p_error_message text default null, p_provider_account_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_found boolean;
  v_binding uuid;
  v_recorded uuid;
begin
  if p_status not in ('pending', 'active', 'failed', 'disabled') then
    raise exception 'unknown resource status: %', p_status using errcode = '22023';
  end if;
  if p_dns_records is not null and not app.valid_email_dns_records(p_dns_records) then
    raise exception 'dns records must be a short array of {type, name, value}' using errcode = '22023';
  end if;

  if p_provider_account_id is not null then
    select r.binding_id, b.provider_account_id into v_binding, v_recorded
      from public.organization_provider_resources r
      join public.organization_provider_bindings b on b.organization_id = r.organization_id and b.id = r.binding_id
     where r.id = p_resource_id and r.organization_id = p_organization_id and r.resource_type = 'resend_domain';
    if v_recorded is not null and v_recorded <> p_provider_account_id then
      raise exception 'that domain is held by a different provider account' using errcode = '22023';
    end if;
    if v_binding is not null and v_recorded is null then
      if not exists (select 1 from public.platform_provider_accounts a
                      join public.organization_provider_bindings b on b.id = v_binding and b.provider_key = a.provider_key
                     where a.id = p_provider_account_id) then
        raise exception 'that provider account does not provide this binding''s service' using errcode = '22023';
      end if;
      update public.organization_provider_bindings set provider_account_id = p_provider_account_id, updated_at = now()
       where id = v_binding and organization_id = p_organization_id and provider_account_id is null;
    end if;
  end if;

  update public.organization_provider_resources
     set status = p_status,
         config =
           -- Each key is set only when this call has something to say about it, so a recheck that
           -- carries no records does not erase the ones registration stored. The two error keys
           -- are cleared outright on success, because a stale error beside a verified domain is
           -- the failure mode this whole file exists to remove.
           (case when p_error_code is null and p_error_message is null
                 then config - 'last_error' - 'error_code'
                 else config
                      || jsonb_build_object('error_code', p_error_code)
                      || jsonb_build_object('last_error', left(p_error_message, 500))
            end)
           || (case when p_provider_domain_id is null then '{}'::jsonb
                    else jsonb_build_object('provider_domain_id', p_provider_domain_id) end)
           || (case when p_provider_status is null then '{}'::jsonb
                    else jsonb_build_object('provider_status', p_provider_status) end)
           || (case when p_dns_records is null then '{}'::jsonb
                    else jsonb_build_object('dns_records', p_dns_records) end),
         last_verified_at = case when p_status = 'active' then now() else last_verified_at end,
         updated_at = now()
   where id = p_resource_id
     and organization_id = p_organization_id
     and resource_type = 'resend_domain'
  returning true into v_found;

  if v_found is null then
    raise exception 'no such sending domain' using errcode = '22023';
  end if;
end $$;
revoke all on function public.record_email_domain_provisioning(uuid, uuid, text, text, text, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_email_domain_provisioning(uuid, uuid, text, text, text, jsonb, text, text, uuid) to provider_operator;

-- Automation deliveries: pinned to a sender, claimed once, and followable.
alter table public.message_deliveries
  add column email_identity_id uuid,
  add column from_address text,
  add column from_name text,
  add column external_id text,
  add column claimed_at timestamptz,
  add column attempts integer not null default 0,
  add column first_attempt_at timestamptz,
  add column provider_state text,
  add column provider_state_at timestamptz,
  add column provider_detail text,
  add constraint message_deliveries_email_identity_fk foreign key (organization_id, email_identity_id) references public.email_identities(organization_id, id),
  add constraint message_deliveries_external_id_check check (external_id is null or length(external_id) between 1 and 200),
  add constraint message_deliveries_attempts_check check (attempts >= 0 and (attempts = 0) = (first_attempt_at is null)),
  add constraint message_deliveries_provider_state_check check (provider_state is null or provider_state = any (array['delivered', 'delayed', 'bounced', 'complained', 'failed', 'rejected'])),
  drop constraint message_deliveries_state_check,
  add constraint message_deliveries_state_check check (state = any (array['queued', 'sending', 'sent', 'failed'])),
  add constraint message_deliveries_claimed_while_sending check ((state = 'sending') = (claimed_at is not null));
-- One delivery per provider message within a business; delivery reports find it by the provider's id.
create unique index message_deliveries_external_id_key on public.message_deliveries (organization_id, external_id) where external_id is not null;
create index message_deliveries_external_id_idx on public.message_deliveries (external_id) where external_id is not null;

-- What a provider later said about an accepted delivery. Only reports about delivery count
-- (opens and clicks prove nothing); a final report is never replaced by a delay, and among final
-- reports the latest by the provider's own time wins, so a late or repeated report cannot roll
-- the record back.
create function app.apply_delivery_report(p_id uuid, p_event_type text, p_detail text, p_event_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz := coalesce(p_event_at, now());
begin
  if p_event_type not in ('delivered', 'delayed', 'bounced', 'complained', 'failed', 'rejected') then
    return;
  end if;
  update public.message_deliveries m
     set provider_state = p_event_type, provider_state_at = v_at, provider_detail = left(p_detail, 500)
   where m.id = p_id
     and (m.provider_state is null
          or (p_event_type <> 'delayed' and (m.provider_state = 'delayed' or v_at >= m.provider_state_at))
          or (p_event_type = 'delayed' and m.provider_state = 'delayed' and v_at >= m.provider_state_at));
end $$;
revoke all on function app.apply_delivery_report(uuid, text, text, timestamptz) from public, anon, authenticated;

-- Taken exactly once before anything is sent.
--
--   * An email is resolved against its pinned sender at claim time, so an address that stopped
--     being ready fails here with the reason instead of being sent; one whose platform account is
--     unavailable simply waits. Its From is fixed at the first attempt and reused on every retry,
--     so a retry is the same request the provider may already have seen.
--   * An interrupted or retried email is attempted again under the same idempotency key only
--     while the provider still remembers that key (a day; 23 hours here, to leave margin). After
--     that a delivery that was already attempted is failed as uncertain, never sent a second time.
--   * An interrupted text message cannot be deduplicated, so it is failed as uncertain.
create function public.claim_message_deliveries(p_limit integer default 50)
returns table (id uuid, channel text, recipient text, subject_line text, body text, from_address text, from_name text, provider_key text, provider_account_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare d public.message_deliveries; s record; v_from text; v_name text;
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
      update public.message_deliveries m set state = 'failed', claimed_at = null,
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
        -- The platform's account is unavailable: not the business's to fix, so it stays queued.
        when sqlstate '58000' then
          if d.state = 'sending' then update public.message_deliveries m set state = 'queued', claimed_at = null where m.id = d.id; end if;
          continue;
      end;
      update public.message_deliveries m
         set state = 'sending', claimed_at = now(), email_identity_id = s.email_identity_id,
             from_address = coalesce(m.from_address, s.from_address),
             from_name = case when m.from_address is null then s.from_name else m.from_name end,
             attempts = m.attempts + 1, first_attempt_at = coalesce(m.first_attempt_at, now())
       where m.id = d.id
       returning m.from_address, m.from_name into v_from, v_name;
      return query select d.id, d.channel, d.recipient, d.subject_line, d.body, v_from, v_name, s.provider_key, s.provider_account_id;
    else
      update public.message_deliveries m
         set state = 'sending', claimed_at = now(), attempts = m.attempts + 1, first_attempt_at = coalesce(m.first_attempt_at, now())
       where m.id = d.id;
      return query select d.id, d.channel, d.recipient, d.subject_line, d.body, null::text, null::text, null::text, null::uuid;
    end if;
  end loop;
end $$;
revoke all on function public.claim_message_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_message_deliveries(integer) to automation_runner;

-- What happened to one claimed delivery. `accepted` means the provider took it, which is all
-- `sent` has ever meant here: arrival is what a later provider report says (`provider_state`).
-- `retry` returns it to the queue; `rejected` and `failed` record why it did not go; `uncertain`
-- records that it may or may not have gone and must not be sent again.
create function public.finish_message_delivery(p_id uuid, p_outcome text, p_external_id text default null, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_external text := nullif(btrim(p_external_id), ''); e record;
begin
  if p_outcome not in ('accepted', 'rejected', 'failed', 'retry', 'uncertain') then
    raise exception 'unknown delivery outcome' using errcode = '22023';
  end if;
  update public.message_deliveries
     set state = case p_outcome when 'accepted' then 'sent' when 'retry' then 'queued' else 'failed' end,
         sent_at = case when p_outcome = 'accepted' then now() end,
         external_id = case when p_outcome = 'accepted' then v_external end,
         detail = case
                    when p_outcome = 'uncertain' then 'Delivery uncertain: ' || coalesce(nullif(btrim(p_detail), ''), 'the provider could not confirm whether it was sent') || '. Check with the recipient before sending again.'
                    when p_outcome in ('rejected', 'failed') then coalesce(nullif(btrim(p_detail), ''), 'the provider did not say why')
                  end,
         claimed_at = null
   where id = p_id and state = 'sending';
  -- Reports that arrived before this acceptance was recorded were held untenanted; apply them now.
  if p_outcome = 'accepted' and v_external is not null then
    for e in select * from app.email_early_events where provider_message_id = v_external order by coalesce(event_at, received_at) loop
      perform app.apply_delivery_report(p_id, e.event_type, e.detail, e.event_at);
    end loop;
    delete from app.email_early_events where provider_message_id = v_external;
  end if;
end $$;
revoke all on function public.finish_message_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_message_delivery(uuid, text, text, text) to automation_runner;

-- The functions the runtime being replaced calls, kept so the API can be deployed after this
-- migration rather than with it. They now hand out and finish text messages only, through the
-- same claim: an email waits for the runtime that sends it from the business's own sender, so the
-- installation-wide address can no longer be used for one, and the two runtimes never both take
-- the same delivery. Removed by a later migration once no runtime calls them.
drop function public.queued_messages(integer);
drop function public.record_message_delivery(uuid, boolean, text);
create function public.queued_messages(p_limit integer default 50)
returns table (id uuid, channel text, recipient text, subject_line text, body text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare d public.message_deliveries;
begin
  for d in
    select * from public.message_deliveries m
     where m.state = 'queued' and m.channel <> 'email'
     order by m.queued_at
     limit least(greatest(p_limit, 1), 200)
     for update skip locked
  loop
    update public.message_deliveries m
       set state = 'sending', claimed_at = now(), attempts = m.attempts + 1, first_attempt_at = coalesce(m.first_attempt_at, now())
     where m.id = d.id;
    return query select d.id, d.channel, d.recipient, d.subject_line, d.body;
  end loop;
end $$;
revoke all on function public.queued_messages(integer) from public, anon, authenticated;
grant execute on function public.queued_messages(integer) to automation_runner;

create function public.record_message_delivery(p_id uuid, p_sent boolean, p_detail text)
returns void language sql security definer set search_path = '' as $$
  select public.finish_message_delivery(p_id, case when p_sent then 'accepted' else 'failed' end, null, p_detail)
$$;
revoke all on function public.record_message_delivery(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.record_message_delivery(uuid, boolean, text) to automation_runner;

-- The functions below are their current definitions with one change each, marked "Changed (Phase 3A)".

CREATE OR REPLACE FUNCTION app.run_automation(p_rule_id uuid, p_subject_type text, p_subject_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule      public.automation_rules;
  v_action    public.automation_actions;
  v_item      public.work_items;
  v_template  public.message_templates;
  v_recipient text;
  v_sender    uuid;
  v_asset     public.assets;
  v_new       uuid;
  v_acted     boolean := false;
begin
  select * into v_rule from public.automation_rules where id = p_rule_id;
  if v_rule.id is null or not v_rule.enabled then
    return false;
  end if;

  if p_subject_type = 'work_item' then
    select * into v_item
      from public.work_items
     where id = p_subject_id and organization_id = v_rule.organization_id;
    if v_item.id is null then
      return false;
    end if;
    if not app.automation_conditions_hold(v_rule.id, v_item) then
      return false;
    end if;
  elsif p_subject_type = 'asset' then
    select * into v_asset
      from public.assets
     where id = p_subject_id and organization_id = v_rule.organization_id;
    if v_asset.id is null then
      return false;
    end if;
  else
    return false;
  end if;

  perform set_config('app.automation_rule_id', v_rule.id::text, true);

  for v_action in
    select * from public.automation_actions
     where rule_id = v_rule.id
     order by position, created_at
  loop
    if v_action.action_kind = 'create_work_item' then
      -- **The job is titled with the rule's name**, which is the business's own sentence about
      -- why this work exists â€” "Service the compressor every five hundred hours". There is
      -- deliberately no separate title field: a second place to write the same thing is a second
      -- place for it to go stale, and the platform has no title of its own to offer.
      insert into public.work_items
        (organization_id, type_id, status_id, asset_id, title, created_by)
      values (
        v_rule.organization_id,
        v_action.work_item_type_id,
        v_action.status_id,
        case when p_subject_type = 'asset' then v_asset.id else v_item.asset_id end,
        v_rule.name,
        '00000000-0000-4000-8000-0000000000a2'
      )
      returning id into v_new;

      insert into public.events
        (organization_id, actor_id, entity_type, entity_id, action, payload)
      values (
        v_rule.organization_id,
        '00000000-0000-4000-8000-0000000000a2',
        'work_item',
        v_new,
        'work_item.created',
        jsonb_build_object(
          'title', v_rule.name,
          'automation_rule_id', v_rule.id,
          'automation_rule_name', v_rule.name
        )
      );

      v_acted := true;

    elsif v_action.action_kind = 'run_tool' then
      -- **Queued here, run by the integration runtime.** A rule fires inside a write, or on the clock with
      -- nobody present; an outside call belongs in neither. Asking twice for one subject asks once.
      v_new := null;
      with ins as (
        insert into public.integration_action_queue
          (organization_id, rule_id, action_id, grant_id, subject_type, subject_id, arguments)
        values
          (v_rule.organization_id, v_rule.id, v_action.id, v_action.grant_id, p_subject_type, p_subject_id,
           v_action.tool_arguments)
        on conflict (organization_id, action_id, subject_type, subject_id) do nothing
        returning id
      )
      select id into v_new from ins;
      IF v_new IS NOT NULL then
        v_acted := true;
      end if;

    elsif p_subject_type <> 'work_item' then
      -- Every other action edits a job that already exists, and this rule is about an asset.
      -- Skipped rather than raised: a rule carrying both kinds of action is a reasonable thing
      -- for a business to write.
      continue;

    elsif v_action.action_kind = 'change_status' then
      if v_item.status_id is distinct from v_action.status_id then
        update public.work_items
           set status_id = v_action.status_id
         where id = v_item.id;

        insert into public.events
          (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          v_rule.organization_id,
          '00000000-0000-4000-8000-0000000000a2',
          'work_item',
          v_item.id,
          'work_item.status_changed',
          jsonb_build_object(
            'status_id', v_action.status_id,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      end if;

    elsif v_action.action_kind = 'shift_schedule' then
      if v_item.scheduled_during is null then
        raise exception 'this job is not in the diary, so there is nothing to move';
      end if;

      update public.work_items
         set scheduled_during = tstzrange(
               lower(v_item.scheduled_during) + make_interval(mins => v_action.shift_minutes),
               upper(v_item.scheduled_during) + make_interval(mins => v_action.shift_minutes),
               '[)'
             )
       where id = v_item.id;

      insert into public.events
        (organization_id, actor_id, entity_type, entity_id, action, payload)
      values (
        v_rule.organization_id,
        '00000000-0000-4000-8000-0000000000a2',
        'work_item',
        v_item.id,
        'work_item.scheduled',
        jsonb_build_object(
          'shift_minutes', v_action.shift_minutes,
          'automation_rule_id', v_rule.id,
          'automation_rule_name', v_rule.name
        )
      );

      select * into v_item from public.work_items where id = v_item.id;
      v_acted := true;

    elsif v_action.action_kind = 'notify' then
      select * into v_template
        from public.message_templates where id = v_action.template_id;

      if v_template.id is null then
        raise exception 'the template this rule writes from is no longer here';
      end if;

      if v_action.channel = 'email' then
        select nullif(btrim(c.email), '') into v_recipient
          from public.customers c where c.id = v_item.customer_id;
      else
        select nullif(btrim(c.phone), '') into v_recipient
          from public.customers c where c.id = v_item.customer_id;
      end if;

      if v_recipient is null then
        raise exception
          'this job has nobody to write to; add a condition so the rule only runs when it does';
      end if;

      -- Changed (Phase 3A): an email names the business's own resolved sender, or the rule fails
      -- here with the reason (recorded by the caller as a failed run; the triggering write stands).
      v_sender := null;
      if v_action.channel = 'email' then
        begin
          select s.email_identity_id into v_sender from app.organization_email_sender(v_rule.organization_id) s;
        exception when sqlstate '58000' then
          -- The platform's account is unavailable right now: queue it on the business's own
          -- default sender anyway; the claim re-resolves it before anything is sent.
          select e.default_email_identity_id into v_sender from public.organization_email_sending e where e.organization_id = v_rule.organization_id;
        end;
      end if;

      begin
        insert into public.message_deliveries
          (organization_id, rule_id, rule_name, subject_type, subject_id, channel, recipient,
           subject_line, body, email_identity_id)
        values (
          v_rule.organization_id, v_rule.id, v_rule.name, 'work_item', v_item.id,
          v_action.channel, v_recipient,
          app.resolve_message_template(v_template.subject, v_item),
          app.resolve_message_template(v_template.body, v_item),
          v_sender
        );

        insert into public.events
          (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          v_rule.organization_id,
          '00000000-0000-4000-8000-0000000000a2',
          'work_item',
          v_item.id,
          'work_item.message_queued',
          jsonb_build_object(
            'channel', v_action.channel,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      exception when unique_violation then
        null;
      end;
    end if;
  end loop;

  perform set_config('app.automation_rule_id', '', true);

  return v_acted;
end;
$function$;

CREATE OR REPLACE FUNCTION app.create_service_notification(org uuid, customer uuid, engagement uuid, revision uuid, review uuid, purpose text, requested boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.service_notification_intents;
begin
 perform pg_advisory_xact_lock(hashtextextended(org::text||customer::text,0));
 i.organization_id:=org; i.customer_id:=customer; i.engagement_id:=engagement; i.revision_id:=revision; i.review_id:=review; i.purpose:=purpose; i.requested:=requested; i.created_at:=now();
 select disclosure_id into i.disclosure_id from public.service_disclosure_revisions where organization_id=org and customer_id=customer and engagement_id=engagement and id=revision;
 select id,email_address into i.recipient_id,i.email_address from public.customer_notification_recipients where organization_id=org and customer_id=customer;
 i.email_identity_id:=app.customer_email_sender(org,customer); -- Changed (Phase 3A): the customer's sender, else the business default.
 i.reason:=case when requested then app.notification_ineligibility(i) end;
 i.state:=case when not requested then 'not_requested' when i.reason like 'Email identity%' then 'failed' when i.reason is not null then 'suppressed' else 'queued' end;
 insert into public.service_notification_intents(organization_id,customer_id,engagement_id,revision_id,disclosure_id,review_id,purpose,requested,recipient_id,email_address,email_identity_id,state,reason,created_by)
 values(org,customer,engagement,revision,i.disclosure_id,review,purpose,requested,i.recipient_id,i.email_address,i.email_identity_id,i.state,i.reason,auth.uid())
 on conflict do nothing returning id into i.id;
 if i.id is null then select id into i.id from public.service_notification_intents where organization_id=org and revision_id=revision and review_id is not distinct from review and service_notification_intents.purpose=create_service_notification.purpose; return i.id; end if;
 if i.state='queued' then perform app.enqueue_service_notification(i); end if;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(org,auth.uid(),'customer',customer,'notification.intent_created',jsonb_build_object('intentId',i.id,'state',i.state,'purpose',purpose));
 return i.id;
end $function$;

CREATE OR REPLACE FUNCTION app.notification_retry_eligible(i public.service_notification_intents)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j app.notification_jobs;
begin
 if i.state in('not_requested','suppressed') then return false; end if;
 select * into j from app.notification_jobs where organization_id=i.organization_id and intent_id=i.id;
 if j.id is null then
  if i.state<>'failed' then return false; end if;
  i.email_identity_id:=app.customer_email_sender(i.organization_id,i.customer_id); -- Changed (Phase 3A): the customer's sender, else the business default.
 else
  if j.state not in('failed','queued') or j.reason is null or j.attempts>=5 or j.first_attempt_at<now()-interval '23 hours' or exists(select 1 from public.messages where organization_id=i.organization_id and id=j.message_id and external_id is not null) then return false; end if;
 end if;
 return app.notification_ineligibility(i) is null;
end $function$;

CREATE OR REPLACE FUNCTION public.retry_service_notification(p_organization_id uuid, p_intent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.service_notification_intents; j app.notification_jobs;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or not app.has_capability(p_organization_id,'message.send') then raise exception 'Customer management and email sending permission required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_intent_id::text,0));
 select * into i from public.service_notification_intents where organization_id=p_organization_id and id=p_intent_id;
 if not found or not app.notification_retry_eligible(i) then raise exception 'This notification cannot be retried safely; check consent, sender readiness and current review/publication' using errcode='PT409'; end if;
 select * into j from app.notification_jobs where organization_id=p_organization_id and intent_id=i.id for update;
 if j.id is null then
  i.email_identity_id:=app.customer_email_sender(p_organization_id,i.customer_id); -- Changed (Phase 3A): the customer's sender, else the business default.
  update public.service_notification_intents set email_identity_id=i.email_identity_id where organization_id=p_organization_id and id=i.id;
  perform app.enqueue_service_notification(i);
 else
  update app.notification_jobs set state='queued',next_attempt_at=now(),reason=null where organization_id=p_organization_id and id=j.id;
  update public.messages set status='queued',failure_reason=null where organization_id=p_organization_id and id=j.message_id;
 end if;
 update public.service_notification_intents set state='queued',reason=null where organization_id=p_organization_id and id=i.id;
end $function$;

CREATE OR REPLACE FUNCTION public.propose_notification_recipient(p_email_address text, p_purposes text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx record; identity_id uuid; address text:=lower(btrim(p_email_address)); code text:=encode(extensions.gen_random_bytes(8),'hex'); challenge uuid; msg uuid;
begin
 select * into ctx from public.portal_context();
 if ctx.organization_id is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ctx.organization_id::text||ctx.customer_id::text,0));
 if address is null or length(address)>254 or address !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$' or p_purposes is null or cardinality(p_purposes)=0 or not p_purposes <@ array['service_review_requested','service_update_published','service_review_status_changed']::text[] then raise exception 'Choose an email address and notification purposes' using errcode='22023'; end if;
 if exists(select 1 from app.notification_challenges where organization_id=ctx.organization_id and customer_id=ctx.customer_id and created_at>now()-interval '1 minute') or (select count(*) from app.notification_challenges where organization_id=ctx.organization_id and customer_id=ctx.customer_id and created_at>now()-interval '1 hour')>=5 then raise exception 'Please wait before requesting another confirmation' using errcode='PT429'; end if;
 identity_id:=app.customer_email_sender(ctx.organization_id,ctx.customer_id); -- Changed (Phase 3A): the customer's sender, else the business default.
 if identity_id is null or not app.email_identity_ready(ctx.organization_id,identity_id) or app.notification_suppressed(ctx.organization_id,address) then raise exception 'The service organization must configure a ready email sender, and the address must be eligible' using errcode='55000'; end if;
 insert into app.notification_challenges(organization_id,customer_id,email_address,purposes,code_hash,actor_id,portal_invite_id)
 values(ctx.organization_id,ctx.customer_id,address,p_purposes,extensions.digest(code,'sha256'),auth.uid(),ctx.portal_invite_id) returning id into challenge;
 msg:=app.queue_customer_notification(ctx.organization_id,ctx.customer_id,identity_id,address,'Confirm service notifications',
 'Enter this confirmation code in the Portal session where you requested service notifications: '||code||E'\n\nThis code expires in 20 minutes. It confirms only the purposes you selected. If you did not request it, ignore this email. This email grants no Portal access.', 'notification-confirm:'||challenge);
 insert into app.notification_jobs(organization_id,customer_id,challenge_id,message_id,email_identity_id) values(ctx.organization_id,ctx.customer_id,challenge,msg,identity_id);
 return challenge;
end $function$;

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
    -- Possibly early: kept, untenanted, for the acceptance that will name its message.
    perform app.hold_early_email_event(p_provider_message_id, p_event_type, p_provider_event_id, p_detail, p_payload, p_event_at);
    return null;
  end if;
  return app.apply_email_event(v_org, v_message, p_event_type, p_provider_event_id, p_detail, p_payload, p_event_at);
end $function$;
