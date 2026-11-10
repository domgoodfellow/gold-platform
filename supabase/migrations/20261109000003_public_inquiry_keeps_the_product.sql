-- A consultation request from the marketing site keeps the product the visitor asked about.
--
-- `/demo?product=dialer` preselects the product, and the Dialer asks a few optional questions
-- (how many people call, shared or own numbers, which calls, rough volume, extras). Before this,
-- `p_business_type` ("what do you want help with") reached only the event payload, which no
-- screen shows. Now a demo request that names a product also starts the discovery answer
-- `productInterest` (apps/web/lib/domain/customers/discovery-requirements.ts), which GildOps staff
-- read on the contact's Discovery tab, `provided` from `demo_form` like the two answers before it.
--
-- Same function, same single write path (D17, D42, I26): one new argument, `p_needs`, holding the
-- product's answers as one line the application composed from fixed options. The target
-- organization is still resolved from platform_settings, never from the caller; the caller still
-- reads nothing back. A contact inquiry ignores `p_needs`.

drop function if exists public.submit_public_inquiry(text, text, text, text, text, text, text, text, text);

create function public.submit_public_inquiry(
  p_kind          text,
  p_name          text,
  p_business_name text,
  p_email         text,
  p_phone         text,
  p_context       text,
  p_team_size     text,
  p_business_type text,
  p_topic         text,
  p_needs         text default ''
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
  v_product  text := nullif(btrim(coalesce(p_business_type, '')), '');
  v_needs    text := case when p_kind = 'demo' then nullif(btrim(coalesce(p_needs, '')), '') end;
  v_interest text;
begin
  if v_actor is null then
    raise exception 'submit_public_inquiry requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_kind not in ('demo', 'contact') then
    raise exception 'unknown inquiry kind' using errcode = '22023';
  end if;

  -- The same bounds the application states (lib/domain/public-intake/limits.ts), held here too
  -- because this function is callable directly.
  if length(coalesce(v_product, '')) > 200 or length(coalesce(v_needs, '')) > 1000 then
    raise exception 'an inquiry answer is too long' using errcode = '22001';
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
      'business_type', v_product,
      'topic', nullif(btrim(p_topic), ''),
      'needs', v_needs
    )
  );

  -- A demo request's `context` is the form's free text ("what you want to fix, and the tools you
  -- use now"), kept as the current-tools answer for staff to confirm; a contact inquiry's
  -- `context` is the sender's message to a person, which is not a discovery answer about their
  -- business and stays in the event payload only.
  if p_kind = 'demo' then
    v_interest := case
      when v_product is not null and v_needs is not null then v_product || ' — ' || v_needs
      else coalesce(v_product, v_needs)
    end;
    if v_interest is not null then
      v_answers := v_answers || jsonb_build_object(
        'productInterest',
        jsonb_build_object('value', v_interest, 'status', 'provided', 'source', 'demo_form', 'updatedAt', v_now)
      );
    end if;
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

comment on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text, text) is
  'The only write a public marketing form may perform, for a demo request or a general contact inquiry. One customer row in GOLD''s own tenant, resolved from platform_settings rather than from anything the caller supplies (D17, D42, I26); whatever of that also reads as a discovery answer, including the product a demo request names and its answers, starts this customer''s discovery snapshot as `provided`, from `demo_form` (I61). No select policy anywhere grants the caller a way to read any of it back afterward.';

revoke all on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_inquiry(text, text, text, text, text, text, text, text, text, text) to authenticated;
