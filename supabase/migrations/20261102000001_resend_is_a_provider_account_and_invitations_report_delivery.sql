-- Resend joins the generic provider-account model (D62), and an invitation's delivery becomes a
-- fact a person can read -- work order 1, sections 6-11.
--
-- **Resend was environment-only.** `RESEND_API_KEY`/`PLATFORM_EMAIL_FROM_ADDRESS` in `apps/web`,
-- `RESEND_API_KEY`/`MESSAGE_FROM_ADDRESS` in `apps/api` -- a credential nobody could rotate
-- without a deploy, and no row to say whether it still worked. `platform_provider_accounts`
-- (D54/D62) already holds exactly this shape for OpenAI, Anthropic, Google and Vercel; `resend` is
-- already a `platform_providers` row (`20260911000001`). No new table -- this file adds the one
-- door apps/api needs that staff's own generic doors don't give it: resolving which account is
-- *default* without the caller having to be staff, because sending an invitation is an ordinary
-- member's action, not a platform-operations one.
--
-- **The environment path stays, as the bootstrap fallback it already was.** A deployment with no
-- Resend account recorded sends exactly as it does today; `app.services.platform_email` tries the
-- account first and falls back, explicitly, never silently preferring one over the other by
-- accident.
--
-- **Delivery is not invitation lifecycle**, restated from the work order's own words. An
-- invitation's `accepted_at`/`revoked_at` says what the *recipient* did; whether GildOps' mail even
-- reached them is a fact the provider reports back, possibly more than once, possibly out of
-- order, possibly never. `invitation_deliveries` is that fact, modelled on `call_events`
-- (`20260905000002`) -- the one table in this schema already proving a provider's callback can
-- retry a delivery and the retry must be a no-op, never a second ending.

-- ---------------------------------------------------------------------------
-- Resend sends can be resent: a reissue invalidates the old link
-- ---------------------------------------------------------------------------

-- The composite-FK target `invitation_deliveries` leads with below (I2), the same shape every
-- other child table in this schema already takes on its own parent.
create unique index organization_invitations_org_id_unique
  on public.organization_invitations (organization_id, id);

-- Policy, stated once rather than left to be inferred from the code: a reissue resets the
-- seven-day window. The whole reason somebody presses Resend is that the original window is
-- stale or about to be -- preserving it would make "resend" mean "show the same dead link again"
-- on exactly the invitations where it matters most.
create function public.reissue_invitation(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_email text;
  v_role  uuid;
  v_token text;
  v_hash  text;
begin
  if v_actor is null then
    raise exception 'reissue_invitation requires an authenticated caller'
      using errcode = '42501';
  end if;

  select organization_id, email, role_id into v_org, v_email, v_role
    from public.organization_invitations
   where id = p_id;

  -- One message for "no such row" and "not yours to resend" -- the same discipline every other
  -- door in this file already holds.
  if v_org is null or not app.has_capability(v_org, 'role.manage') then
    raise exception 'you cannot resend that invitation'
      using errcode = '42501';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_hash  := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  -- A single UPDATE is the whole of the concurrency story: two overlapping presses of Resend both
  -- succeed in program order, and whichever commits last leaves its own hash as the only one that
  -- can ever validate -- a single column cannot hold two valid tokens at once, so "ambiguous
  -- multiple valid links" is not a state this schema can reach.
  update public.organization_invitations
     set token_hash = v_hash,
         expires_at = now() + interval '7 days'
   where id = p_id
     and revoked_at is null
     and accepted_at is null;

  if not found then
    raise exception 'that invitation can no longer be resent' using errcode = '22023';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.member_invitation_reissued',
     jsonb_build_object('invitation_id', p_id, 'email', v_email, 'role_id', v_role));

  return v_token;
end;
$fn$;

comment on function public.reissue_invitation(uuid) is
  'Rotates a pending invitation onto a fresh token and a fresh seven-day window; the old link stops validating the instant this commits, because token_hash is a single column. Refuses a revoked or already-accepted row, the same as invite_member creating a fresh one would.';

revoke all on function public.reissue_invitation(uuid) from public;
grant execute on function public.reissue_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- invitation_deliveries -- what was attempted, and what the provider said about it
-- ---------------------------------------------------------------------------

create table public.invitation_deliveries (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references public.organizations (id) on delete cascade,
  invitation_id        uuid        not null,

  recipient            text        not null check (length(btrim(recipient)) > 0),

  -- Who produced this row: the immediate result of asking the provider to send (`send`), or a
  -- later callback about what happened to it (`webhook`). Platform vocabulary describing our own
  -- write paths, the same reason `call_events.source` exists.
  source               text        not null check (source in ('send', 'webhook')),

  -- GildOps' own vocabulary for where a send stands. `queued` is the only `send`-sourced state
  -- besides `failed`; every state past it is the provider's own report.
  state                text        not null
                        check (state in ('queued', 'sent', 'delivered', 'delayed', 'bounced', 'failed', 'suppressed')),

  -- Resend's own id for the message, correlatable across every event about one send. Null when
  -- the attempt never reached the provider at all (no account, no credential, unreachable).
  provider_message_id  text        check (provider_message_id is null or length(btrim(provider_message_id)) <= 200),

  -- The provider's own words, kept short (I25) -- never this platform's paraphrase.
  detail               text        check (detail is null or length(detail) <= 500),

  -- The webhook's own payload, for a `webhook`-sourced row; `{}` for a `send`-sourced one. A jsonb
  -- object rather than a text blob, the same reasoning `call_events.payload` gives.
  payload              jsonb       not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),

  -- The retry guard. A `send`-sourced row's hash is always fresh (one send, one row); a
  -- `webhook`-sourced row's hash is computed by the caller from the delivery it received, so a
  -- carrier's retried callback is a no-op here exactly as `call_events_org_payload_hash_unique`
  -- already makes one for a call.
  payload_hash         text        not null check (length(btrim(payload_hash)) between 1 and 128),

  occurred_at          timestamptz not null default now(),

  constraint invitation_deliveries_invitation_same_org
    foreign key (organization_id, invitation_id)
    references public.organization_invitations (organization_id, id) on delete cascade
);

comment on table public.invitation_deliveries is
  'Every attempt and every provider callback about sending one invitation''s email, kept once each. Current standing is the latest row by occurred_at for an invitation_id -- never summarised into the invitation row itself, so an invitation''s own lifecycle (accepted/revoked) stays a fact about the recipient and this stays a fact about the mail.';

-- I2, and the retry guard -- the same shape call_events_org_payload_hash_unique already proves.
create unique index invitation_deliveries_org_payload_hash_unique
  on public.invitation_deliveries (organization_id, payload_hash);

create index invitation_deliveries_org_invitation_idx
  on public.invitation_deliveries (organization_id, invitation_id, occurred_at desc);

-- How a webhook event finds its way back to an organization and an invitation without ever being
-- told either (see record_invitation_delivery_event below): by the provider's own message id,
-- which only a `send`-sourced row can have planted first.
create index invitation_deliveries_provider_message_idx
  on public.invitation_deliveries (provider_message_id)
  where provider_message_id is not null;

alter table public.invitation_deliveries enable row level security;
alter table public.invitation_deliveries force  row level security;

-- Readable by whoever can see the invitation itself -- the same capability, the same reasoning
-- `call_events_select` gives: when somebody asks why a send says what it says, the answer is here.
create policy invitation_deliveries_select on public.invitation_deliveries
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'role.manage'));

grant select on public.invitation_deliveries to authenticated;
-- No insert/update/delete grant to any role: the two doors below are the only writers, exactly as
-- for call_events, and this table is never edited, only appended to.

-- ---------------------------------------------------------------------------
-- The webhook's own identity -- a fourth role beside voice_webhook, sms_webhook, payment_webhook
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000a6')
on conflict (id) do nothing;

-- 00000000-0000-4000-8000-0000000000a6 is the invitation-email-delivery integration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'invitation_email_webhook') then
    create role invitation_email_webhook nologin noinherit;
  end if;
end
$$;

grant invitation_email_webhook to authenticator;
grant usage on schema public to invitation_email_webhook;

-- ---------------------------------------------------------------------------
-- Recording the immediate result of a send -- provider_operator, same trusted path as reading the
-- Resend credential that made the send possible in the first place (D45's own reasoning for
-- resolve_ai_runtime_assignment: one more step in the same already-proven path, not a second axis)
-- ---------------------------------------------------------------------------

create function public.record_invitation_delivery(
  p_organization_id    uuid,
  p_invitation_id      uuid,
  p_recipient          text,
  p_state              text,
  p_provider_message_id text default null,
  p_detail             text default null,
  p_payload_hash        text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_state not in ('queued', 'sent', 'failed') then
    raise exception 'a send result is queued, sent or failed' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_invitations
     where id = p_invitation_id and organization_id = p_organization_id
  ) then
    raise exception 'no such invitation' using errcode = '22023';
  end if;

  insert into public.invitation_deliveries
    (organization_id, invitation_id, recipient, source, state, provider_message_id, detail, payload_hash)
  values
    (p_organization_id, p_invitation_id, p_recipient, 'send', p_state, p_provider_message_id,
     p_detail, coalesce(p_payload_hash, gen_random_uuid()::text))
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_invitation_delivery(uuid, uuid, text, text, text, text, text) is
  'What apps/api got back immediately after asking a provider to send one invitation''s email. provider_operator only -- the same role that read the credential this send used.';

revoke all on function public.record_invitation_delivery(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_invitation_delivery(uuid, uuid, text, text, text, text, text) to provider_operator;

-- ---------------------------------------------------------------------------
-- Recording a provider callback -- invitation_email_webhook, a stranger's own door
-- ---------------------------------------------------------------------------

-- **The caller names no organization and no invitation**, exactly as record_call_event's own
-- comment states it: it supplies the provider's own message id; both are derived from the `send`
-- row that id already belongs to. A callback for a message id this platform never sent finds
-- nothing and writes nothing -- harmless for a retry, useless for a forgery.
create function public.record_invitation_delivery_event(
  p_provider_message_id text,
  p_state               text,
  p_detail              text,
  p_payload             jsonb,
  p_payload_hash        text
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
    (organization_id, invitation_id, recipient, source, state, provider_message_id, detail, payload, payload_hash)
  values
    (v_org, v_invitation, v_recipient, 'webhook', p_state, p_provider_message_id, p_detail,
     coalesce(p_payload, '{}'::jsonb), p_payload_hash)
  on conflict (organization_id, payload_hash) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_invitation_delivery_event(text, text, text, jsonb, text) is
  'The only thing invitation_email_webhook may do. Derives the organization and invitation from the send row the provider''s own message id already belongs to; the caller names neither. A repeated payload (same organization_id, payload_hash) is a no-op, the same guard call_events holds.';

revoke all on function public.record_invitation_delivery_event(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_invitation_delivery_event(text, text, text, jsonb, text) to invitation_email_webhook;

-- ---------------------------------------------------------------------------
-- Resolving the default Resend account without the caller being staff
-- ---------------------------------------------------------------------------

-- Every other reader of `platform_provider_accounts` is staff-only RLS (`platform_provider_accounts_select`),
-- because every other caller of `provider_operator`'s doors has already proven the human asking is
-- staff before minting that token (`app.services.providers.operations`). Sending an invitation is
-- not a platform-operations act -- it is any member with `role.manage` doing an ordinary thing --
-- so apps/api needs a door that answers "which account is this provider's default" without that
-- proof. It returns an id and nothing else: not the label, not whether one exists at all beyond
-- that, the smallest fact that lets read_provider_account_credential be asked for next.
create function public.default_platform_provider_account(p_provider_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select a.id from public.platform_provider_accounts a
   where a.provider_key = p_provider_key and a.status = 'active' and a.is_default;
$fn$;

comment on function public.default_platform_provider_account(text) is
  'The default active account id for one provider, or null -- the one fact app.services.platform_email needs from a table every other reader of must be staff to see.';

revoke all on function public.default_platform_provider_account(text) from public, anon, authenticated;
grant execute on function public.default_platform_provider_account(text) to provider_operator;
