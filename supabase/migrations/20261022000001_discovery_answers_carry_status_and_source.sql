-- A discovery answer is now a small document — value, status, source, when it was last touched —
-- not a bare string. Slice 4 of the commercial-funnel plan: a canonical requirement catalogue
-- (`apps/web/lib/domain/customers/discovery-requirements.ts`) needs somewhere to record where an
-- answer stands (`provided`, given by the prospect themselves and unconfirmed; `confirmed`, read
-- and affirmed by a person here), which public intake's own two mapped fields already have a real
-- answer for: whatever a demo request gives is `provided`, from `demo_form`, never `confirmed` --
-- nobody here has read it yet.
--
-- No schema change: `customer_discovery_snapshots.answers` was already an opaque jsonb document
-- (I61); only the shape the domain layer reads and writes changes, so this migration touches only
-- `submit_public_inquiry`, the one writer outside the authenticated domain layer.

create or replace function public.submit_public_inquiry(
  p_kind          text,
  p_name          text,
  p_business_name text,
  p_email         text,
  p_phone         text,
  p_context       text,
  p_team_size     text,
  p_business_type text,
  p_topic         text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_target   uuid;
  v_business text := btrim(p_business_name);
  v_person   text := btrim(p_name);
  v_label    text;
  v_customer uuid;
  v_now      timestamptz := now();
  v_answers  jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'submit_public_inquiry requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_kind not in ('demo', 'contact') then
    raise exception 'unknown inquiry kind' using errcode = '22023';
  end if;

  -- A demo request is about a business; a general inquiry is from a person, who may not have one.
  -- The customer row is named for whichever the sender gave, never for a word the platform chose.
  v_label := case when p_kind = 'demo' then v_business else coalesce(nullif(v_business, ''), v_person) end;
  if coalesce(v_label, '') = '' then
    raise exception 'a name is required' using errcode = '23514';
  end if;

  select workflow_review_organization_id into v_target
  from public.platform_settings
  where singleton;

  -- Honest absence (D31): a deployment that has not run the snippet takes no inquiry rather
  -- than filing one nobody will ever see.
  if v_target is null then
    raise exception 'public intake is not configured on this deployment'
      using errcode = 'GD001';
  end if;

  insert into public.customers (organization_id, name, email, phone, created_by)
  values (v_target, v_label, nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), v_actor)
  returning id into v_customer;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    v_target, v_actor, 'customer', v_customer, 'customer.created',
    jsonb_build_object(
      'name', v_label,
      'source', p_kind,
      'contact_name', nullif(v_person, ''),
      'context', nullif(btrim(p_context), ''),
      'team_size', nullif(btrim(p_team_size), ''),
      'business_type', nullif(btrim(p_business_type), ''),
      'topic', nullif(btrim(p_topic), '')
    )
  );

  -- Only a demo request's `context` is genuinely "what do you use today" (the field the form
  -- labels that way); a contact inquiry's `context` is the sender's message to a person, which
  -- is not a discovery answer about their business and stays in the event payload only.
  if p_kind = 'demo' then
    if nullif(btrim(p_team_size), '') is not null then
      v_answers := v_answers || jsonb_build_object(
        'teamAccess',
        jsonb_build_object('value', btrim(p_team_size), 'status', 'provided', 'source', 'demo_form', 'updatedAt', v_now)
      );
    end if;
    if nullif(btrim(p_context), '') is not null then
      v_answers := v_answers || jsonb_build_object(
        'existingSoftware',
        jsonb_build_object('value', btrim(p_context), 'status', 'provided', 'source', 'demo_form', 'updatedAt', v_now)
      );
    end if;
  end if;

  if v_answers <> '{}'::jsonb then
    insert into public.customer_discovery_snapshots (organization_id, customer_id, answers, created_by)
    values (v_target, v_customer, v_answers, v_actor);
  end if;
end;
$fn$;

comment on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text) is
  'The only write a public marketing form may perform, for a demo request or a general contact inquiry. One customer row in GOLD''s own tenant, resolved from platform_settings rather than from anything the caller supplies (D17, D42, I26); whatever of that also reads as a discovery answer starts this customer''s discovery snapshot as `provided`, from `demo_form` (I61). No select policy anywhere grants the caller a way to read any of it back afterward.';

revoke all on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text) to authenticated;
