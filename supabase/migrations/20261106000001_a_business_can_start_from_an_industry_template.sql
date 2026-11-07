-- A business can start from an industry template, and the owner always confirms it first.
--
-- Three things, one change:
--
-- 1. `industry_templates`: a platform-wide catalogue of starting setups, the same standing
--    `form_templates` has. Organizations read published rows and never write; platform staff
--    holding `platform.catalogue` manage them. A template's `shape` is a `BusinessShape` document,
--    validated by the application (`readBusinessShape`) exactly as a drafted proposal is.
-- 2. Where a template becomes a business: always a `configuration_proposals` draft the owner
--    reviews and applies. A template chosen by the owner, chosen by staff when provisioning, or
--    agreed in a sales hand-off all land as that draft. `origin` says which, `template_key` says
--    from what, and `deferred_at` records that the owner set it aside for later (it stays a draft).
-- 3. `organization_identity.starting_template_key`: which template a business started from,
--    recorded once, when a template draft is first applied.
--
-- Nothing here applies configuration. Staff and the sales hand-off only *offer* a draft; the
-- owner's own session applies it through the canonical owners, as every proposal is applied.

-- ---------------------------------------------------------------------------
-- 1. The catalogue
-- ---------------------------------------------------------------------------

create table public.industry_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name        text not null check (length(btrim(name)) between 1 and 120),
  category    text not null check (length(btrim(category)) between 1 and 60),
  description text not null check (length(btrim(description)) between 1 and 300),
  shape       jsonb not null check (jsonb_typeof(shape) = 'object'),
  published   boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.industry_templates is
  'Platform-wide starting setups a business can begin from. Read-only to organizations (published rows only); managed by platform staff holding platform.catalogue. A template never configures anything itself: choosing one creates a configuration_proposals draft the owner reviews and applies.';

alter table public.industry_templates enable row level security;
alter table public.industry_templates force row level security;

create policy industry_templates_select on public.industry_templates
  for select to authenticated
  using (published or (select app.has_platform_capability('platform.catalogue')));

create policy industry_templates_insert on public.industry_templates
  for insert to authenticated
  with check ((select app.has_platform_capability('platform.catalogue')));

create policy industry_templates_update on public.industry_templates
  for update to authenticated
  using ((select app.has_platform_capability('platform.catalogue')))
  with check ((select app.has_platform_capability('platform.catalogue')));

revoke all on public.industry_templates from public, anon, authenticated;
grant select, insert on public.industry_templates to authenticated;
grant update (name, category, description, shape, published, position, updated_at)
  on public.industry_templates to authenticated;
grant all on public.industry_templates to service_role;

-- ---------------------------------------------------------------------------
-- 2. Where a template becomes a draft
-- ---------------------------------------------------------------------------

alter table public.configuration_proposals
  -- Plain text, not a foreign key: a proposal references only its business and its author
  -- (`proposals.test.ts`). The writers below check the template exists.
  add column template_key text check (template_key is null or template_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  add column origin text not null default 'drafted'
    check (origin in ('drafted', 'template', 'provisioned', 'agreed')),
  add column deferred_at timestamptz;

comment on column public.configuration_proposals.origin is
  'Where this draft came from: drafted (from the business''s own description), template (the owner chose a starting template), provisioned (GildOps staff chose one when creating the business) or agreed (part of an accepted sales proposal). Written once.';
comment on column public.configuration_proposals.template_key is
  'The industry template this draft started from, if any. Written once.';
comment on column public.configuration_proposals.deferred_at is
  'When the owner set this draft aside for later. It stays a draft, available from Setup, until applied or discarded.';

-- A member may draft from a description or start from a template themselves. `provisioned` and
-- `agreed` drafts are written only by the staff doors below, so nobody inside a business can
-- make a draft claim GildOps offered or agreed it.
drop policy configuration_proposals_insert on public.configuration_proposals;
create policy configuration_proposals_insert on public.configuration_proposals
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'configuration.propose')
    and origin in ('drafted', 'template')
    and deferred_at is null
    and (template_key is null
         or exists (select 1 from public.industry_templates t where t.key = template_key and t.published))
  );

grant update (deferred_at) on public.configuration_proposals to authenticated;

-- The one writer of a staff- or sales-offered draft. The template's shape, shallowly overlaid with
-- whatever was agreed (a top-level key in `p_adjustments` replaces the template's). The owner sees
-- and can change all of it before anything is applied.
create function app.stage_starting_draft(
  p_organization_id uuid,
  p_template_key    text,
  p_adjustments     jsonb,
  p_origin          text,
  p_actor           uuid,
  p_drafted_by      text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_template public.industry_templates;
  v_shape    jsonb;
  v_key      text;
  v_id       uuid;
begin
  if p_origin not in ('provisioned', 'agreed') then
    raise exception 'a staff-offered draft is provisioned or agreed' using errcode = '22023';
  end if;

  select * into v_template
    from public.industry_templates
   where key = p_template_key and published;
  if v_template.id is null then
    raise exception 'There is no published starting template called %.', p_template_key
      using errcode = '23503';
  end if;

  v_shape := v_template.shape;
  if p_adjustments is not null and p_adjustments <> 'null'::jsonb then
    if jsonb_typeof(p_adjustments) <> 'object' then
      raise exception 'setup adjustments must be an object' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_adjustments) loop
      if v_key <> all (array['workTypes', 'fields', 'prices', 'hours', 'roles', 'modules', 'featureKeys',
                             'voice', 'brand', 'wording', 'portal']) then
        raise exception 'unknown setup adjustment: %', v_key using errcode = '22023';
      end if;
    end loop;
    v_shape := v_shape || p_adjustments;
  end if;

  insert into public.configuration_proposals
    (organization_id, description, shape, drafted_by, created_by, template_key, origin)
  values
    (p_organization_id, v_template.name, v_shape, p_drafted_by, p_actor, v_template.key, p_origin)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function app.stage_starting_draft(uuid, text, jsonb, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff provisioning may name a template (recreated in full; applied migrations are not edited).
-- The one change from `20261022000079` is `p_template_key`: when given, the new business gets a
-- pending draft from it in the same transaction, so there is never a business whose agreed
-- starting point was lost between two requests. Existing seven-argument calls still resolve.
-- ---------------------------------------------------------------------------

drop function public.provision_organization(text, text, text, text[], text, text, text);

create function public.provision_organization(
  p_owner_email  text,
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text,
  p_template_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff       uuid := (select auth.uid());
  v_staff_name  text;
  v_owner       uuid;
  v_owner_email text := lower(btrim(p_owner_email));
  v_org         uuid;
  v_role        uuid;
begin
  perform app.require_platform_capability('platform.organizations');
  if v_staff is null then
    raise exception 'provision_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  select s.name into v_staff_name
    from public.platform_staff s
   where s.user_id = v_staff;

  if v_staff_name is null then
    raise exception 'only platform staff may provision a business'
      using errcode = '42501';
  end if;

  select u.id into v_owner
    from auth.users u
   where lower(u.email) = v_owner_email;

  if v_owner is null then
    raise exception 'Nobody with the address % has an account yet. They have to sign up before a business can be handed to them.', v_owner_email
      using errcode = '23503';
  end if;

  if coalesce((select u.is_anonymous from auth.users u where u.id = v_owner), true) then
    raise exception 'that account cannot own a business'
      using errcode = '42501';
  end if;

  if p_currency is null then
    raise exception 'an organization must say what currency it trades in'
      using errcode = '23514';
  end if;

  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_owner)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_owner)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_owner, v_role, p_display_name, v_owner);

  perform app.grant_founding_terms(v_org, v_owner);

  if nullif(btrim(p_template_key), '') is not null then
    perform app.stage_starting_draft(v_org, btrim(p_template_key), null, 'provisioned', v_staff, v_staff_name);
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_staff, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency,
       'provisioned', true,
       'provisioned_by', v_staff_name,
       'owner_email', v_owner_email,
       'starting_template', nullif(btrim(p_template_key), '')
     ));

  return v_org;
end;
$function$;

revoke all on function public.provision_organization(text, text, text, text[], text, text, text, text) from public, anon;
grant execute on function public.provision_organization(text, text, text, text[], text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The sales hand-off turns an agreed template into a pending draft (recreated in full from
-- `20261031000005`). An accepted proposal's `accepted_configuration` may carry
-- `{"template": {"key": "...", "adjustments": {...}}}`; when it does, the new business gets an
-- `agreed` draft of that template with those adjustments, in the same transaction as the
-- business itself. Everything else is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.hand_off_accepted_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor          uuid := (select auth.uid());
  v_staff_name     text;
  v_proposal       public.customer_commercial_proposals;
  v_customer       public.contacts;
  v_snapshot       jsonb;
  v_addons         jsonb;
  v_addon          jsonb;
  v_terms          jsonb;
  v_org            uuid;
  v_constraint     text;
  v_capabilities   text[];
  v_note           text;
  v_total_minor    bigint;
  v_template       jsonb;
begin
  perform app.require_platform_capability('platform.organizations');
  if v_actor is null then
    raise exception 'hand_off_accepted_proposal requires an authenticated caller'
      using errcode = '42501';
  end if;

  select s.name into v_staff_name from public.platform_staff s where s.user_id = v_actor;
  if v_staff_name is null then
    raise exception 'only platform staff may create a business from a proposal'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_proposal_id::text));

  select * into v_proposal from public.customer_commercial_proposals where id = p_proposal_id;
  if v_proposal.id is null then
    raise exception 'no such proposal'
      using errcode = '42501';
  end if;
  perform app.require_capability(v_proposal.organization_id, 'customer.update');
  if v_proposal.basis <> 'platform_plan' then
    raise exception 'only a Platform Plan proposal can create a business'
      using errcode = '42501';
  end if;
  if v_proposal.status <> 'accepted' then
    raise exception 'only an accepted proposal can be handed off'
      using errcode = '42501';
  end if;

  select created_organization_id into v_org
    from public.customer_proposal_handoffs
   where organization_id = v_proposal.organization_id and proposal_id = p_proposal_id;
  if v_org is not null then
    return v_org;
  end if;

  select * into v_customer
    from public.contacts
   where organization_id = v_proposal.organization_id and id = v_proposal.customer_id;
  if v_customer.id is null then
    raise exception 'no such customer'
      using errcode = '42501';
  end if;
  if v_customer.email is null then
    raise exception 'this customer has no email on file -- the owner needs an address to sign in with'
      using errcode = '23514';
  end if;

  select answers into v_snapshot
    from public.customer_discovery_snapshots
   where organization_id = v_proposal.organization_id and customer_id = v_proposal.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'addonPlanId', addon_plan_id, 'label', label, 'priceMinor', price_minor
         )), '[]'::jsonb)
    into v_addons
    from public.customer_commercial_proposal_addons
   where organization_id = v_proposal.organization_id and proposal_id = p_proposal_id;

  v_terms := jsonb_build_object(
    'planId', v_proposal.plan_id,
    'planLabel', v_proposal.plan_label,
    'addons', v_addons,
    'currency', v_proposal.currency,
    'billingInterval', v_proposal.billing_interval,
    'planPriceMinor', v_proposal.plan_price_minor,
    'addonPriceMinor', v_proposal.addon_price_minor,
    'discountMinor', v_proposal.discount_minor,
    'discountReason', v_proposal.discount_reason,
    'version', v_proposal.version
  );

  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass and c.conname = 'roles_capabilities_known';
  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[]) into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  v_org := public.provision_organization(
    v_customer.email, v_customer.name, 'Admin', v_capabilities, 'Owner', null, v_proposal.currency
  );

  v_note := 'Accepted proposal ' || p_proposal_id::text || ', v' || v_proposal.version::text;

  perform app.write_plan_assignment(
    v_org, v_proposal.plan_id, current_date, date '9999-12-31', v_actor, v_note);

  for v_addon in select * from jsonb_array_elements(v_addons)
  loop
    perform app.write_plan_assignment(
      v_org, (v_addon ->> 'addonPlanId')::uuid, current_date, date '9999-12-31', v_actor, v_note
    );
  end loop;

  v_total_minor := greatest(0, v_proposal.plan_price_minor + v_proposal.addon_price_minor - v_proposal.discount_minor);
  perform app.write_plan_agreement(
    v_org, v_proposal.plan_id, v_proposal.currency, v_total_minor, now(), null, v_actor, v_note
  );

  -- What was agreed about how the business starts becomes a draft its owner reviews.
  v_template := v_proposal.accepted_configuration -> 'template';
  if v_template is not null and jsonb_typeof(v_template) = 'object' and nullif(btrim(v_template ->> 'key'), '') is not null then
    perform app.stage_starting_draft(
      v_org, btrim(v_template ->> 'key'), v_template -> 'adjustments', 'agreed', v_actor, v_staff_name
    );
  end if;

  insert into public.customer_proposal_handoffs
    (organization_id, customer_id, proposal_id, created_organization_id,
     discovery_snapshot, accepted_configuration, commercial_terms, created_by)
  values
    (v_proposal.organization_id, v_proposal.customer_id, p_proposal_id, v_org,
     coalesce(v_snapshot, '{}'::jsonb), v_proposal.accepted_configuration, v_terms, v_actor);

  return v_org;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Which template a business started from
-- ---------------------------------------------------------------------------

alter table public.organization_identity
  add column starting_template_key text references public.industry_templates (key) on update cascade;

comment on column public.organization_identity.starting_template_key is
  'The industry template this business started from, recorded once when a draft from it was first applied. Null for a business that started blank or from its own description.';

-- Recorded once: a business that later applies a second template still started from the first.
create function public.record_starting_template(p_organization_id uuid, p_template_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'configuration.propose') then
    raise exception 'you may not set up this business' using errcode = '42501';
  end if;
  if not exists (select 1 from public.industry_templates where key = p_template_key) then
    raise exception 'There is no starting template called %.', p_template_key using errcode = '23503';
  end if;

  insert into public.organization_identity as i (organization_id, starting_template_key, updated_by)
  values (p_organization_id, p_template_key, v_actor)
  on conflict (organization_id) do update
    set starting_template_key = excluded.starting_template_key
  where i.starting_template_key is null;
end;
$fn$;

revoke all on function public.record_starting_template(uuid, text) from public, anon;
grant execute on function public.record_starting_template(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Three published templates
-- ---------------------------------------------------------------------------
-- Roles in "Answering service" are copies of ROLE_PRESETS entries (`support`, `manager`) by
-- label and capability list; `proposals.test.ts` keeps them equal. Prices are left out: an amount
-- means nothing until a business has a currency, so each business enters its own.

insert into public.industry_templates (key, name, category, description, position, published, shape) values
('answering_service', 'Answering service', 'Professional services',
 'Answer calls for your own clients, take messages and book callbacks.', 10, true,
 $json${
  "workTypes": [
    {"name": "Inbound call", "schedulable": false,
     "stages": [{"name": "Answered"}, {"name": "Message taken"}, {"name": "Passed on", "marksComplete": true, "releasesResource": true}],
     "transitions": [[0, 1], [1, 2], [0, 2]],
     "checklist": ["Caller's name and number", "Reason for the call", "Message passed to the client"]},
    {"name": "Callback", "schedulable": true,
     "stages": [{"name": "Booked"}, {"name": "Calling"}, {"name": "Done", "marksComplete": true, "releasesResource": true}, {"name": "No answer", "releasesResource": true}],
     "transitions": [[0, 1], [1, 2], [1, 3], [3, 0]],
     "checklist": ["Check who to call back", "Record the outcome"],
     "requirements": [{"resourceClass": "person", "quantity": 1}]}
  ],
  "fields": {"customer": [
    {"key": "answer_as", "label": "Answer calls as", "kind": "text", "required": false},
    {"key": "cover_hours", "label": "Hours we cover", "kind": "text", "required": false},
    {"key": "call_instructions", "label": "Call instructions", "kind": "text", "required": false}
  ]},
  "prices": [],
  "hours": [
    {"dayOfWeek": 1, "opensAt": "08:00", "closesAt": "18:00"},
    {"dayOfWeek": 2, "opensAt": "08:00", "closesAt": "18:00"},
    {"dayOfWeek": 3, "opensAt": "08:00", "closesAt": "18:00"},
    {"dayOfWeek": 4, "opensAt": "08:00", "closesAt": "18:00"},
    {"dayOfWeek": 5, "opensAt": "08:00", "closesAt": "18:00"}
  ],
  "roles": [
    {"name": "Support", "capabilities": ["customer.create", "customer.update", "call.place", "message.send", "document.create", "work_item.create", "assistant.ask"]},
    {"name": "Manager", "capabilities": ["customer.create", "customer.update", "location.create", "resource.create", "resource.update", "work_item.create", "asset.create", "document.create", "work_item.transition", "work_item.schedule", "work_item.record", "work_item.price", "work_item.update", "invoice.issue", "payment.record", "assistant.ask", "report.read", "call.place", "message.send"]}
  ],
  "modules": ["reception"],
  "wording": {
    "nouns": {"work": {"singular": "Call", "plural": "Calls"}, "customer": {"singular": "Client", "plural": "Clients"}},
    "navigation": ["home", "calls", "work", "customers", "schedule"]
  },
  "portal": {"forms": [{"template": "contact_us", "name": "Contact us"}]}
 }$json$::jsonb),
('rental_field_service', 'Rental and field service', 'Construction and renovation',
 'Hire out equipment, deliver it to site and track it until it comes back.', 20, true,
 $json${
  "workTypes": [
    {"name": "Hire", "schedulable": true,
     "stages": [{"name": "Requested"}, {"name": "Scheduled"}, {"name": "Out with customer"}, {"name": "Returned"}, {"name": "Finished", "marksComplete": true}, {"name": "Cancelled", "releasesResource": true}],
     "transitions": [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [1, 5], [2, 5]],
     "booking": {"stage": 0, "durationMinutes": 60}}
  ],
  "fields": {
    "work_item": [
      {"key": "site_location", "label": "Site location", "kind": "text", "required": false},
      {"key": "registration", "label": "Registration", "kind": "text", "required": false},
      {"key": "condition", "label": "Condition at hand-out", "kind": "select", "required": false, "options": ["New", "Good", "Needs maintenance"]},
      {"key": "return_date", "label": "Expected return date", "kind": "date", "required": false}
    ],
    "customer": [{"key": "company_number", "label": "Company number", "kind": "text", "required": false}]
  },
  "prices": [],
  "hours": [
    {"dayOfWeek": 1, "opensAt": "07:00", "closesAt": "17:30"},
    {"dayOfWeek": 2, "opensAt": "07:00", "closesAt": "17:30"},
    {"dayOfWeek": 3, "opensAt": "07:00", "closesAt": "17:30"},
    {"dayOfWeek": 4, "opensAt": "07:00", "closesAt": "17:30"},
    {"dayOfWeek": 5, "opensAt": "07:00", "closesAt": "16:00"},
    {"dayOfWeek": 6, "opensAt": "08:00", "closesAt": "12:00"}
  ],
  "roles": [{"name": "Yard hand", "capabilities": ["work_item.create", "work_item.transition", "work_item.record"]}],
  "modules": ["billing", "assets", "reporting"]
 }$json$::jsonb),
('appointment_clinic', 'Appointment clinic', 'Health and wellness',
 'Book appointments into rooms and keep notes on each visit.', 30, true,
 $json${
  "workTypes": [
    {"name": "Consultation", "schedulable": true,
     "stages": [{"name": "Received"}, {"name": "Booked"}, {"name": "Done", "marksComplete": true}, {"name": "Cancelled", "releasesResource": true}],
     "transitions": [[0, 1], [1, 2], [0, 3], [1, 3]],
     "booking": {"stage": 0, "durationMinutes": 60}}
  ],
  "fields": {
    "work_item": [
      {"key": "findings", "label": "Findings", "kind": "text", "required": false},
      {"key": "visit_type", "label": "Visit type", "kind": "select", "required": false, "options": ["First visit", "Follow-up", "Check-up"]}
    ],
    "customer": [
      {"key": "insurance_number", "label": "Insurance number", "kind": "text", "required": false},
      {"key": "allergies", "label": "Allergies", "kind": "multi_select", "required": false, "options": ["Pollen", "Medication", "Food"]}
    ]
  },
  "prices": [],
  "hours": [
    {"dayOfWeek": 1, "opensAt": "09:00", "closesAt": "18:00"},
    {"dayOfWeek": 2, "opensAt": "09:00", "closesAt": "18:00"},
    {"dayOfWeek": 3, "opensAt": "09:00", "closesAt": "12:30"},
    {"dayOfWeek": 4, "opensAt": "09:00", "closesAt": "18:00"},
    {"dayOfWeek": 5, "opensAt": "09:00", "closesAt": "18:00"}
  ],
  "roles": [{"name": "Reception", "capabilities": ["work_item.create", "work_item.transition", "work_item.record"]}],
  "modules": ["billing", "reporting"]
 }$json$::jsonb);

-- ---------------------------------------------------------------------------
-- Trying again after a failed apply
-- ---------------------------------------------------------------------------
-- A failed proposal stays failed (it is the record of what went wrong); trying again is a new
-- draft carrying the same document, the same origin and the same template, which the owner
-- reviews and applies. Applying is safe to repeat, so the second apply finishes what the first
-- started. A definer function because a member may not write `provisioned` or `agreed` drafts
-- directly, and a retry of one must keep saying where it came from.
create function public.retry_configuration_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_proposal public.configuration_proposals;
  v_id       uuid;
begin
  select * into v_proposal from public.configuration_proposals where id = p_proposal_id;
  if v_actor is null or v_proposal.id is null
     or v_proposal.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_proposal.organization_id, 'configuration.propose') then
    raise exception 'you may not set up this business' using errcode = '42501';
  end if;
  if v_proposal.outcome <> 'failed' then
    raise exception 'only a setup that stopped part-way can be tried again' using errcode = '55000';
  end if;

  insert into public.configuration_proposals
    (organization_id, description, shape, gaps, drafted_by, created_by, template_key, origin)
  values
    (v_proposal.organization_id, v_proposal.description, v_proposal.shape, v_proposal.gaps,
     v_proposal.drafted_by, v_actor, v_proposal.template_key, v_proposal.origin)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.retry_configuration_proposal(uuid) from public, anon;
grant execute on function public.retry_configuration_proposal(uuid) to authenticated;
