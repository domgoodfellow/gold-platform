-- A form is something a business publishes and a stranger fills in, and what the stranger
-- submitted is a fact that must stay readable after the form changes.
--
-- **Three things, kept apart.** A *form* is a stable identity (a name and a public address). A
-- *revision* is one immutable definition of it — the fields a visitor was shown. A *submission* is
-- one visitor's answers, and it names the exact revision it was answered against, so a label
-- renamed or a field removed next month never makes last month's answers unreadable. Booking
-- intake is not this: it is a use of form primitives with its own write (`create_booking`), and
-- stays as it is.
--
-- **The revision shape is the public-site one (`20260916000001`) without the review step.** One
-- working draft, one published revision, a stable pointer on the form, published and archived
-- revisions immutable. Review is dropped on purpose: it exists to put a second person between a
-- draft and GildOps' own marketing homepage, and a business's contact form has no second person to
-- put there. A draft is still never what a visitor sees — publishing is the only door.
--
-- **Authority.** No role holds a table grant. A tenant reaches everything through the functions
-- below, each of which proves `organization.manage` first (`app.require_public_site_manager`) —
-- the capability that already governs a business's public surfaces. A visitor reaches exactly two:
-- reading the one published revision (`published_form`) and submitting to it (`submit_public_form`).
-- Neither accepts an organization id; both resolve the business from its public slug (D17).
--
-- **Validation is authoritative here.** TypeScript repeats it (`@gold/schemas`) for a better error
-- message; these functions are what every possible writer meets.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.forms (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- The public address segment. Chosen once from the name and never changed, so a link a business
  -- has already shared keeps working when it renames the form.
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) <= 60),
  current_published_revision_id uuid,
  -- Copied, never joined (I8): which platform starter this began as. Changing or removing the
  -- template later changes nothing here.
  created_from_template_key text,
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  unique (organization_id, slug),
  check ((archived_at is null) = (archived_by is null))
);

create table public.form_revisions (
  organization_id uuid not null,
  form_id uuid not null,
  id uuid not null default gen_random_uuid(),
  revision_number integer not null check (revision_number > 0),
  status text not null check (status in ('draft', 'published', 'archived')),
  definition jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  published_at timestamptz,
  published_by uuid references auth.users (id),
  archived_at timestamptz,
  primary key (organization_id, form_id, id),
  foreign key (organization_id, form_id)
    references public.forms (organization_id, id) on delete cascade,
  unique (organization_id, form_id, revision_number),
  check ((status = 'draft' and published_at is null and archived_at is null) or
         (status = 'published' and published_at is not null and published_by is not null and archived_at is null) or
         (status = 'archived' and published_at is not null and archived_at is not null))
);

alter table public.forms
  add constraint forms_published_revision_belongs_to_form
  foreign key (organization_id, id, current_published_revision_id)
  references public.form_revisions (organization_id, form_id, id);

-- One draft being worked on, one revision being served. Structural, not a rule every writer
-- remembers.
create unique index form_one_working_revision
  on public.form_revisions (organization_id, form_id) where status = 'draft';
create unique index form_one_published_revision
  on public.form_revisions (organization_id, form_id) where status = 'published';

create table public.form_submissions (
  organization_id uuid not null,
  form_id uuid not null,
  form_revision_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  -- The anonymous session the visitor held for the length of one write; there is no visitor
  -- identity beyond it.
  submitted_by uuid not null references auth.users (id),
  source text not null default 'hosted' check (source in ('hosted')),
  -- Server-supplied facts about how it arrived. Small and never personal.
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 2000),
  -- Keyed by the revision's stable field ids; the revision is what gives a key its meaning.
  answers jsonb not null
    check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 20000),
  primary key (organization_id, id),
  foreign key (organization_id, form_id, form_revision_id)
    references public.form_revisions (organization_id, form_id, id)
);

create index form_submissions_form_recent
  on public.form_submissions (organization_id, form_id, submitted_at desc);

-- Platform-owned starters. Not tenant data: no `organization_id`, no grant, read only through
-- `list_form_templates`. A business's own saved templates will be a separate tenant-owned table
-- when one is built — this one is never reinterpreted as organization data.
create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 300),
  category text not null check (length(btrim(category)) between 1 and 60),
  definition jsonb not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.forms enable row level security;
alter table public.forms force row level security;
alter table public.form_revisions enable row level security;
alter table public.form_revisions force row level security;
alter table public.form_submissions enable row level security;
alter table public.form_submissions force row level security;
alter table public.form_templates enable row level security;
alter table public.form_templates force row level security;

revoke all on public.forms from public, anon, authenticated;
revoke all on public.form_revisions from public, anon, authenticated;
revoke all on public.form_submissions from public, anon, authenticated;
revoke all on public.form_templates from public, anon, authenticated;

comment on table public.form_submissions is
  'One visitor''s answers, naming the exact revision they were given. Written only by submit_public_form; never updated or deleted by any role. Not a Customer: any link to CRM is a consumer of the form.submitted event.';

-- ---------------------------------------------------------------------------
-- The definition vocabulary
-- ---------------------------------------------------------------------------

-- Ten field types, bounded text, no HTML, no expression and no free-form key. A field's `id` is
-- its identity — labels are copy and may change; ids may not be reused for a different meaning
-- inside one revision, and a submission is keyed by them.
create function app.form_definition_is_valid(p_definition jsonb, p_publishing boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_field jsonb;
  v_option jsonb;
  v_ids text[] := '{}';
  v_values text[];
  v_type text;
  v_key text;
  v_allowed text[];
begin
  if jsonb_typeof(p_definition) <> 'object' then return false; end if;
  for v_key in select jsonb_object_keys(p_definition) loop
    if v_key <> all (array['title','description','submitLabel','confirmation','fields']) then return false; end if;
  end loop;

  if jsonb_typeof(p_definition->'title') <> 'string'
     or length(btrim(p_definition->>'title')) not between 1 and 120 then return false; end if;
  if p_definition ? 'description' and (jsonb_typeof(p_definition->'description') <> 'string'
     or length(p_definition->>'description') > 600) then return false; end if;
  if jsonb_typeof(p_definition->'submitLabel') <> 'string'
     or length(btrim(p_definition->>'submitLabel')) not between 1 and 40 then return false; end if;

  if jsonb_typeof(p_definition->'confirmation') <> 'object' then return false; end if;
  for v_key in select jsonb_object_keys(p_definition->'confirmation') loop
    if v_key <> all (array['title','message']) then return false; end if;
  end loop;
  if jsonb_typeof(p_definition->'confirmation'->'title') <> 'string'
     or length(btrim(p_definition->'confirmation'->>'title')) not between 1 and 120 then return false; end if;
  if jsonb_typeof(p_definition->'confirmation'->'message') <> 'string'
     or length(p_definition->'confirmation'->>'message') > 600 then return false; end if;

  if jsonb_typeof(p_definition->'fields') <> 'array' then return false; end if;
  if jsonb_array_length(p_definition->'fields') > 40 then return false; end if;
  if p_publishing and jsonb_array_length(p_definition->'fields') < 1 then return false; end if;

  for v_field in select * from jsonb_array_elements(p_definition->'fields') loop
    if jsonb_typeof(v_field) <> 'object' then return false; end if;
    v_type := v_field->>'type';
    if v_type is null or v_type <> all (array['short_text','long_text','email','phone','number','date','select','radio','checkbox','consent']) then
      return false;
    end if;

    v_allowed := array['id','type','label','description','placeholder','required'];
    if v_type in ('select','radio','checkbox') then v_allowed := v_allowed || array['options']; end if;
    if v_type in ('short_text','long_text') then v_allowed := v_allowed || array['maxLength']; end if;
    if v_type = 'number' then v_allowed := v_allowed || array['min','max']; end if;
    for v_key in select jsonb_object_keys(v_field) loop
      if v_key <> all (v_allowed) then return false; end if;
    end loop;

    if jsonb_typeof(v_field->'id') <> 'string' or (v_field->>'id') !~ '^[a-z][a-z0-9_]{0,39}$' then return false; end if;
    if (v_field->>'id') = any (v_ids) then return false; end if;
    v_ids := v_ids || (v_field->>'id');

    if jsonb_typeof(v_field->'label') <> 'string'
       or length(btrim(v_field->>'label')) not between 1 and 160 then return false; end if;
    if v_field ? 'description' and (jsonb_typeof(v_field->'description') <> 'string'
       or length(v_field->>'description') > 300) then return false; end if;
    if v_field ? 'placeholder' and (jsonb_typeof(v_field->'placeholder') <> 'string'
       or length(v_field->>'placeholder') > 120) then return false; end if;
    if v_field ? 'required' and jsonb_typeof(v_field->'required') <> 'boolean' then return false; end if;

    if v_type in ('select','radio','checkbox') then
      if jsonb_typeof(v_field->'options') <> 'array'
         or jsonb_array_length(v_field->'options') not between 1 and 30 then return false; end if;
      v_values := '{}';
      for v_option in select * from jsonb_array_elements(v_field->'options') loop
        if jsonb_typeof(v_option) <> 'object' then return false; end if;
        for v_key in select jsonb_object_keys(v_option) loop
          if v_key <> all (array['value','label']) then return false; end if;
        end loop;
        if jsonb_typeof(v_option->'value') <> 'string' or (v_option->>'value') !~ '^[a-z0-9_]{1,40}$' then return false; end if;
        if jsonb_typeof(v_option->'label') <> 'string'
           or length(btrim(v_option->>'label')) not between 1 and 120 then return false; end if;
        if (v_option->>'value') = any (v_values) then return false; end if;
        v_values := v_values || (v_option->>'value');
      end loop;
    end if;

    if v_field ? 'maxLength' and (jsonb_typeof(v_field->'maxLength') <> 'number'
       or (v_field->>'maxLength') !~ '^[0-9]{1,4}$' or (v_field->>'maxLength')::integer not between 1 and 4000) then
      return false;
    end if;
    if v_field ? 'min' and jsonb_typeof(v_field->'min') <> 'number' then return false; end if;
    if v_field ? 'max' and jsonb_typeof(v_field->'max') <> 'number' then return false; end if;
    if v_field ? 'min' and v_field ? 'max' and (v_field->>'min')::numeric > (v_field->>'max')::numeric then return false; end if;
  end loop;

  return true;
end;
$fn$;

-- What a visitor's answers are checked against: the revision they were shown. Returns the first
-- thing wrong in a sentence a person can read, or null when the answers are acceptable.
create function app.form_answers_problem(p_definition jsonb, p_answers jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_field jsonb;
  v_known text[];
  v_key text;
  v_id text;
  v_type text;
  v_value jsonb;
  v_text text;
  v_label text;
  v_required boolean;
  v_options text[];
  v_item jsonb;
  v_cap integer;
  v_number numeric;
begin
  if jsonb_typeof(p_answers) <> 'object' then return 'The answers were not in the expected shape.'; end if;
  if octet_length(p_answers::text) > 20000 then return 'The answers are too large.'; end if;

  select coalesce(array_agg(f->>'id'), '{}') into v_known from jsonb_array_elements(p_definition->'fields') f;
  for v_key in select jsonb_object_keys(p_answers) loop
    if v_key <> all (v_known) then return 'An answer was given for a question this form does not ask.'; end if;
  end loop;

  for v_field in select * from jsonb_array_elements(p_definition->'fields') loop
    v_id := v_field->>'id';
    v_type := v_field->>'type';
    v_label := v_field->>'label';
    v_required := coalesce((v_field->>'required')::boolean, false);
    v_value := p_answers->v_id;

    if v_value is null or v_value = 'null'::jsonb
       or (jsonb_typeof(v_value) = 'string' and btrim(v_value #>> '{}') = '')
       or (jsonb_typeof(v_value) = 'array' and jsonb_array_length(v_value) = 0)
       or (v_type = 'consent' and v_value = 'false'::jsonb) then
      if v_required then return format('“%s” is required.', v_label); end if;
      continue;
    end if;

    if v_type in ('short_text','long_text','phone','email','date','select','radio') then
      if jsonb_typeof(v_value) <> 'string' then return format('“%s” must be text.', v_label); end if;
      v_text := v_value #>> '{}';
    end if;

    if v_type in ('short_text','long_text') then
      v_cap := coalesce((v_field->>'maxLength')::integer, case when v_type = 'short_text' then 500 else 4000 end);
      if length(v_text) > v_cap then return format('“%s” is too long.', v_label); end if;
    elsif v_type = 'phone' then
      if length(v_text) not between 3 and 50 then return format('“%s” is not a valid phone number.', v_label); end if;
    elsif v_type = 'email' then
      if length(v_text) > 320 or v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        return format('“%s” is not a valid email address.', v_label);
      end if;
    elsif v_type = 'date' then
      begin
        if v_text !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'shape'; end if;
        perform v_text::date;
      exception when others then
        return format('“%s” is not a valid date.', v_label);
      end;
    elsif v_type = 'number' then
      if jsonb_typeof(v_value) <> 'number' then return format('“%s” must be a number.', v_label); end if;
      v_number := (v_value #>> '{}')::numeric;
      if v_field ? 'min' and v_number < (v_field->>'min')::numeric then return format('“%s” is too small.', v_label); end if;
      if v_field ? 'max' and v_number > (v_field->>'max')::numeric then return format('“%s” is too large.', v_label); end if;
    elsif v_type in ('select','radio') then
      select array_agg(o->>'value') into v_options from jsonb_array_elements(v_field->'options') o;
      if v_text <> all (v_options) then return format('“%s” is not one of the choices.', v_label); end if;
    elsif v_type = 'checkbox' then
      if jsonb_typeof(v_value) <> 'array' then return format('“%s” must be a list of choices.', v_label); end if;
      select array_agg(o->>'value') into v_options from jsonb_array_elements(v_field->'options') o;
      if (select count(distinct x) from jsonb_array_elements_text(v_value) x) <> jsonb_array_length(v_value) then
        return format('“%s” repeats a choice.', v_label);
      end if;
      for v_item in select * from jsonb_array_elements(v_value) loop
        if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') <> all (v_options) then
          return format('“%s” includes something that is not a choice.', v_label);
        end if;
      end loop;
    elsif v_type = 'consent' then
      if jsonb_typeof(v_value) <> 'boolean' then return format('“%s” must be yes or no.', v_label); end if;
    end if;
  end loop;

  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Revisions keep their word
-- ---------------------------------------------------------------------------

create function app.guard_form_revision()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if not app.form_definition_is_valid(new.definition, new.status = 'published') then
    raise exception 'the form definition does not match the supported vocabulary' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('published', 'archived') and
       (new.definition is distinct from old.definition or
        new.revision_number is distinct from old.revision_number or
        new.created_at is distinct from old.created_at or
        new.created_by is distinct from old.created_by) then
      raise exception 'a published form revision is immutable' using errcode = '55000';
    end if;
    -- Forward only: a draft is published, a published revision is archived, nothing returns.
    if new.status is distinct from old.status and
       not ((old.status = 'draft' and new.status = 'published') or
            (old.status = 'published' and new.status = 'archived')) then
      raise exception 'a form revision cannot move from % to %', old.status, new.status using errcode = '55000';
    end if;
  end if;
  return new;
end;
$fn$;

create trigger form_revision_guard
before insert or update on public.form_revisions
for each row execute function app.guard_form_revision();

-- ---------------------------------------------------------------------------
-- Starters (platform vocabulary)
-- ---------------------------------------------------------------------------

insert into public.form_templates (key, name, description, category, display_order, definition) values
('contact_us', 'Contact us', 'A name, an email address and a message — the simplest way to be reached.', 'General', 10,
 $json${"title":"Contact us","description":"Send us a message and we will get back to you.","submitLabel":"Send message","confirmation":{"title":"Thanks for getting in touch","message":"We have your message and will reply soon."},"fields":[
  {"id":"name","type":"short_text","label":"Your name","required":true},
  {"id":"email","type":"email","label":"Email address","required":true},
  {"id":"message","type":"long_text","label":"How can we help?","required":true}]}$json$::jsonb),
('request_a_quote', 'Request a quote', 'Collects what a business needs to price a job: who, what, where and when.', 'Sales', 20,
 $json${"title":"Request a quote","description":"Tell us about the job and we will send you a price.","submitLabel":"Request quote","confirmation":{"title":"Quote request received","message":"We will review the details and come back to you with a price."},"fields":[
  {"id":"name","type":"short_text","label":"Your name","required":true},
  {"id":"email","type":"email","label":"Email address","required":true},
  {"id":"phone","type":"phone","label":"Phone number"},
  {"id":"service","type":"select","label":"What do you need?","required":true,"options":[{"value":"installation","label":"Installation"},{"value":"repair","label":"Repair"},{"value":"inspection","label":"Inspection"},{"value":"other","label":"Something else"}]},
  {"id":"address","type":"short_text","label":"Where is the job?","description":"Street address or area."},
  {"id":"preferred_date","type":"date","label":"When would you like it done?"},
  {"id":"details","type":"long_text","label":"Describe the job","required":true}]}$json$::jsonb),
('service_request', 'Service request', 'An existing customer asks for work, with how urgent it is.', 'Service', 30,
 $json${"title":"Request service","description":"Let us know what needs attention.","submitLabel":"Send request","confirmation":{"title":"Request received","message":"We will be in touch to arrange a time."},"fields":[
  {"id":"name","type":"short_text","label":"Your name","required":true},
  {"id":"email","type":"email","label":"Email address","required":true},
  {"id":"phone","type":"phone","label":"Phone number","required":true},
  {"id":"urgency","type":"radio","label":"How urgent is it?","required":true,"options":[{"value":"emergency","label":"Emergency"},{"value":"soon","label":"This week"},{"value":"flexible","label":"Whenever suits"}]},
  {"id":"issue","type":"long_text","label":"What is the problem?","required":true}]}$json$::jsonb),
('lead_intake', 'Lead intake', 'Qualifies a new enquiry: how they found you, what they want and whether they agree to be contacted.', 'Sales', 40,
 $json${"title":"Tell us what you are looking for","description":"A few questions so we can point you to the right person.","submitLabel":"Submit","confirmation":{"title":"Thank you","message":"Someone will contact you shortly."},"fields":[
  {"id":"name","type":"short_text","label":"Your name","required":true},
  {"id":"email","type":"email","label":"Email address","required":true},
  {"id":"phone","type":"phone","label":"Phone number"},
  {"id":"interests","type":"checkbox","label":"What are you interested in?","options":[{"value":"product_a","label":"Product or service A"},{"value":"product_b","label":"Product or service B"},{"value":"not_sure","label":"Not sure yet"}]},
  {"id":"source","type":"select","label":"How did you hear about us?","options":[{"value":"search","label":"Search"},{"value":"referral","label":"Referral"},{"value":"social","label":"Social media"},{"value":"other","label":"Other"}]},
  {"id":"notes","type":"long_text","label":"Anything else we should know?"},
  {"id":"contact_consent","type":"consent","label":"I agree to be contacted about my enquiry.","required":true}]}$json$::jsonb),
('customer_feedback', 'Customer feedback', 'A rating and a few words after the work is done.', 'Service', 50,
 $json${"title":"How did we do?","description":"Your feedback helps us improve.","submitLabel":"Send feedback","confirmation":{"title":"Thank you for your feedback","message":"We read every response."},"fields":[
  {"id":"rating","type":"radio","label":"Overall, how was your experience?","required":true,"options":[{"value":"5","label":"Excellent"},{"value":"4","label":"Good"},{"value":"3","label":"Fair"},{"value":"2","label":"Poor"},{"value":"1","label":"Very poor"}]},
  {"id":"comments","type":"long_text","label":"Tell us more"},
  {"id":"email","type":"email","label":"Email address","description":"Only if you would like a reply."}]}$json$::jsonb),
('general_inquiry', 'General inquiry', 'A short enquiry with a topic, for businesses that field several kinds of question.', 'General', 60,
 $json${"title":"Ask us a question","submitLabel":"Send","confirmation":{"title":"Question received","message":"We will answer as soon as we can."},"fields":[
  {"id":"name","type":"short_text","label":"Your name","required":true},
  {"id":"email","type":"email","label":"Email address","required":true},
  {"id":"topic","type":"select","label":"What is it about?","options":[{"value":"pricing","label":"Pricing"},{"value":"availability","label":"Availability"},{"value":"an_existing_job","label":"An existing job"},{"value":"something_else","label":"Something else"}]},
  {"id":"question","type":"long_text","label":"Your question","required":true}]}$json$::jsonb);

-- A starter that fails the rules every revision meets would only surface when somebody used it.
do $check$
begin
  if exists (select 1 from public.form_templates where not app.form_definition_is_valid(definition, true)) then
    raise exception 'a form template does not match the form definition vocabulary';
  end if;
end
$check$;

-- ---------------------------------------------------------------------------
-- Tenant doors
-- ---------------------------------------------------------------------------

create function app.form_slug_for(p_organization_id uuid, p_name text)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_base text := left(trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g')), 50);
  v_slug text;
  v_n integer := 1;
begin
  if v_base = '' then v_base := 'form'; end if;
  v_slug := v_base;
  while exists (select 1 from public.forms where organization_id = p_organization_id and slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$fn$;

create function app.form_default_definition(p_name text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'title', left(btrim(p_name), 120),
    'submitLabel', 'Submit',
    'confirmation', jsonb_build_object('title', 'Thank you', 'message', 'Your response has been received.'),
    'fields', '[]'::jsonb);
$fn$;

create function public.create_form(p_organization_id uuid, p_name text, p_template_key text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_form uuid;
  v_revision uuid;
  v_definition jsonb;
  v_name text := btrim(p_name);
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  if length(v_name) not between 1 and 120 then
    raise exception 'a form needs a name of up to 120 characters' using errcode = '23514';
  end if;

  if p_template_key is null then
    v_definition := app.form_default_definition(v_name);
  else
    select definition into v_definition from public.form_templates where key = p_template_key;
    if v_definition is null then raise exception 'that template does not exist' using errcode = 'GD001'; end if;
  end if;

  insert into public.forms (organization_id, name, slug, created_from_template_key, created_by)
  values (p_organization_id, v_name, app.form_slug_for(p_organization_id, v_name), p_template_key, v_actor)
  returning id into v_form;

  insert into public.form_revisions (organization_id, form_id, revision_number, status, definition, created_by)
  values (p_organization_id, v_form, 1, 'draft', v_definition, v_actor)
  returning id into v_revision;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', v_form, 'form.created',
          jsonb_build_object('template_key', p_template_key));

  return jsonb_build_object('formId', v_form, 'revisionId', v_revision);
end;
$fn$;

create function public.list_forms(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_public_site_manager(p_organization_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'slug', f.slug,
      'archived', f.archived_at is not null,
      'publishedRevisionNumber', pub.revision_number,
      'publishedAt', pub.published_at,
      'hasDraft', exists (select 1 from public.form_revisions d
                           where d.organization_id = f.organization_id and d.form_id = f.id and d.status = 'draft'),
      'submissionCount', (select count(*) from public.form_submissions s
                           where s.organization_id = f.organization_id and s.form_id = f.id),
      'lastSubmittedAt', (select max(s.submitted_at) from public.form_submissions s
                           where s.organization_id = f.organization_id and s.form_id = f.id),
      'updatedAt', f.updated_at
    ) order by f.archived_at is not null, f.updated_at desc)
    from public.forms f
    left join public.form_revisions pub on pub.organization_id = f.organization_id
      and pub.form_id = f.id and pub.id = f.current_published_revision_id
    where f.organization_id = p_organization_id
  ), '[]'::jsonb);
end;
$fn$;

create function public.form_editor_state(p_organization_id uuid, p_form_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  select jsonb_build_object(
    'form', jsonb_build_object('id', f.id, 'name', f.name, 'slug', f.slug, 'archived', f.archived_at is not null,
                               'createdFromTemplateKey', f.created_from_template_key),
    'published', case when pub.id is null then null else jsonb_build_object(
      'id', pub.id, 'number', pub.revision_number, 'status', pub.status,
      'definition', pub.definition, 'publishedAt', pub.published_at) end,
    'working', case when w.id is null then null else jsonb_build_object(
      'id', w.id, 'number', w.revision_number, 'status', w.status,
      'definition', w.definition, 'publishedAt', null) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'number', h.revision_number, 'status', h.status,
      'publishedAt', h.published_at, 'archivedAt', h.archived_at,
      'submissionCount', (select count(*) from public.form_submissions s
                           where s.organization_id = h.organization_id and s.form_revision_id = h.id)
    ) order by h.revision_number desc) from public.form_revisions h
      where h.organization_id = f.organization_id and h.form_id = f.id), '[]'::jsonb)
  ) into v_result
  from public.forms f
  left join public.form_revisions pub on pub.organization_id = f.organization_id
    and pub.form_id = f.id and pub.id = f.current_published_revision_id
  left join public.form_revisions w on w.organization_id = f.organization_id
    and w.form_id = f.id and w.status = 'draft'
  where f.organization_id = p_organization_id and f.id = p_form_id;
  return v_result;
end;
$fn$;

create function public.rename_form(p_organization_id uuid, p_form_id uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  if length(btrim(p_name)) not between 1 and 120 then
    raise exception 'a form needs a name of up to 120 characters' using errcode = '23514';
  end if;
  update public.forms set name = btrim(p_name), updated_at = now()
   where organization_id = p_organization_id and id = p_form_id returning id into v_found;
  if v_found is null then raise exception 'that form does not exist in this organization' using errcode = 'GD001'; end if;
end;
$fn$;

-- A published revision cannot be edited, so changing a live form begins by taking a copy of it.
create function public.create_form_draft(p_organization_id uuid, p_form_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_revision uuid; v_number integer; v_definition jsonb; v_archived timestamptz; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select id, archived_at into v_found, v_archived from public.forms
   where organization_id = p_organization_id and id = p_form_id for update;
  if v_found is null then raise exception 'that form does not exist in this organization' using errcode = 'GD001'; end if;
  if v_archived is not null then raise exception 'an archived form cannot be edited' using errcode = 'GD001'; end if;

  select id into v_revision from public.form_revisions
   where organization_id = p_organization_id and form_id = p_form_id and status = 'draft';
  if v_revision is not null then return v_revision; end if;

  select r.definition into v_definition
    from public.forms f join public.form_revisions r
      on r.organization_id = f.organization_id and r.form_id = f.id and r.id = f.current_published_revision_id
   where f.organization_id = p_organization_id and f.id = p_form_id;
  if v_definition is null then
    select definition into v_definition from public.form_revisions
     where organization_id = p_organization_id and form_id = p_form_id order by revision_number desc limit 1;
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_number from public.form_revisions
   where organization_id = p_organization_id and form_id = p_form_id;
  insert into public.form_revisions (organization_id, form_id, revision_number, status, definition, created_by)
  values (p_organization_id, p_form_id, v_number, 'draft', v_definition, v_actor)
  returning id into v_revision;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', p_form_id, 'form.draft_created', jsonb_build_object('revision_number', v_number));
  return v_revision;
end;
$fn$;

create function public.save_form_draft(p_organization_id uuid, p_revision_id uuid, p_definition jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_form uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  update public.form_revisions r set definition = p_definition
   where r.organization_id = p_organization_id and r.id = p_revision_id and r.status = 'draft'
     and exists (select 1 from public.forms f where f.organization_id = r.organization_id and f.id = r.form_id and f.archived_at is null)
  returning r.form_id into v_form;
  if v_form is null then raise exception 'only a draft in this organization can be edited' using errcode = 'GD001'; end if;
  update public.forms set updated_at = now() where organization_id = p_organization_id and id = v_form;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', v_form, 'form.draft_updated', '{}'::jsonb);
end;
$fn$;

create function public.publish_form_revision(p_organization_id uuid, p_revision_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_form uuid; v_previous uuid; v_archived timestamptz;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  select form_id into v_form from public.form_revisions
   where organization_id = p_organization_id and id = p_revision_id and status = 'draft' for update;
  if v_form is null then raise exception 'only a draft can be published' using errcode = 'GD001'; end if;

  select current_published_revision_id, archived_at into v_previous, v_archived from public.forms
   where organization_id = p_organization_id and id = v_form for update;
  if v_archived is not null then raise exception 'an archived form cannot be published' using errcode = 'GD001'; end if;

  if v_previous is not null then
    update public.form_revisions set status = 'archived', archived_at = now()
     where organization_id = p_organization_id and form_id = v_form and id = v_previous and status = 'published';
  end if;
  -- The guard trigger holds a published definition to the stricter rule (at least one field).
  update public.form_revisions set status = 'published', published_at = now(), published_by = v_actor
   where organization_id = p_organization_id and form_id = v_form and id = p_revision_id;
  update public.forms set current_published_revision_id = p_revision_id, updated_at = now()
   where organization_id = p_organization_id and id = v_form;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', v_form, 'form.published',
          jsonb_build_object('revision_id', p_revision_id, 'previous_revision_id', v_previous));
end;
$fn$;

-- Archiving takes a form off the public address and out of the list's way. Nothing is deleted:
-- its revisions and every submission stay readable.
create function public.set_form_archived(p_organization_id uuid, p_form_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare v_actor uuid; v_found uuid;
begin
  v_actor := app.require_public_site_manager(p_organization_id);
  update public.forms set
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then v_actor else null end,
    updated_at = now()
   where organization_id = p_organization_id and id = p_form_id returning id into v_found;
  if v_found is null then raise exception 'that form does not exist in this organization' using errcode = 'GD001'; end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'form', p_form_id,
          case when p_archived then 'form.archived' else 'form.restored' end, '{}'::jsonb);
end;
$fn$;

create function public.list_form_submissions(p_organization_id uuid, p_form_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not exists (select 1 from public.forms where organization_id = p_organization_id and id = p_form_id) then
    return null;
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.form_submissions
               where organization_id = p_organization_id and form_id = p_form_id),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'submittedAt', s.submitted_at, 'revisionId', s.form_revision_id,
        'source', s.source, 'answers', s.answers) order by s.submitted_at desc)
      from (select * from public.form_submissions
             where organization_id = p_organization_id and form_id = p_form_id
             order by submitted_at desc limit v_limit) s), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.revision_number, 'definition', r.definition))
      from public.form_revisions r
      where r.organization_id = p_organization_id and r.form_id = p_form_id
        and r.id in (select form_revision_id from public.form_submissions
                      where organization_id = p_organization_id and form_id = p_form_id)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$fn$;

create function public.list_form_templates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', key, 'name', name, 'description', description, 'category', category, 'definition', definition
  ) order by display_order, name), '[]'::jsonb)
  from public.form_templates
  where (select auth.uid()) is not null;
$fn$;

-- ---------------------------------------------------------------------------
-- The visitor's two doors
-- ---------------------------------------------------------------------------

-- The only anonymous read: one published revision of a form that is not archived, with the
-- business's own public identity. A draft, an archived form and a made-up address are all the same
-- empty answer.
create function public.published_form(p_organization_slug text, p_form_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'formId', f.id,
    'revisionId', r.id,
    'revisionNumber', r.revision_number,
    'name', f.name,
    'definition', r.definition,
    'profile', jsonb_build_object(
      'displayName', coalesce(op.display_name, o.name),
      'tagline', op.tagline, 'intro', op.intro,
      'contactEmail', op.contact_email, 'contactPhone', op.contact_phone, 'address', op.address),
    'brand', jsonb_build_object(
      'accent', b.accent,
      'headingFont', coalesce(b.heading_font, 'sans'),
      'bodyFont', coalesce(b.body_font, 'sans'),
      'logoPath', b.logo_path)
  )
  from public.organizations o
  join public.forms f on f.organization_id = o.id and f.slug = lower(btrim(p_form_slug)) and f.archived_at is null
  join public.form_revisions r on r.organization_id = f.organization_id and r.form_id = f.id
    and r.id = f.current_published_revision_id and r.status = 'published'
  left join public.organization_profiles op on op.organization_id = o.id
  left join public.brand_settings b on b.organization_id = o.id
  where o.slug = lower(btrim(p_organization_slug));
$fn$;

-- A visitor's one write. The business and the form come from the public address, never from an id
-- the caller supplies (D17); the revision the visitor was shown must still be the published one,
-- and the answers are checked against exactly that revision.
create function public.submit_public_form(
  p_organization_slug text,
  p_form_slug text,
  p_revision_id uuid,
  p_answers jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_form uuid;
  v_current uuid;
  v_definition jsonb;
  v_number integer;
  v_problem text;
  v_submission uuid;
begin
  if v_actor is null then
    raise exception 'submit_public_form requires an authenticated caller' using errcode = '42501';
  end if;

  select f.organization_id, f.id, f.current_published_revision_id
    into v_org, v_form, v_current
    from public.organizations o
    join public.forms f on f.organization_id = o.id and f.slug = lower(btrim(p_form_slug)) and f.archived_at is null
   where o.slug = lower(btrim(p_organization_slug));
  if v_form is null or v_current is null then
    raise exception 'this form is not accepting responses' using errcode = 'GD001';
  end if;

  -- The visitor loaded an earlier version. Their answers belong to a form that no longer exists as
  -- shown; they are told to reload rather than having them quietly judged against another one.
  if v_current is distinct from p_revision_id then
    raise exception 'this form has changed since it was opened' using errcode = 'GD002';
  end if;

  select definition, revision_number into v_definition, v_number from public.form_revisions
   where organization_id = v_org and form_id = v_form and id = v_current and status = 'published';

  v_problem := app.form_answers_problem(v_definition, p_answers);
  if v_problem is not null then raise exception '%', v_problem using errcode = '23514'; end if;

  insert into public.form_submissions (organization_id, form_id, form_revision_id, submitted_by, answers)
  values (v_org, v_form, v_current, v_actor, p_answers)
  returning id into v_submission;

  -- The fact, not what anyone does about it: the answers stay in the submission (they are personal),
  -- and whatever consumes the event reads them from there.
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_org, v_actor, 'form_submission', v_submission, 'form.submitted',
          jsonb_build_object('form_id', v_form, 'revision_id', v_current, 'revision_number', v_number));

  return v_submission;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function app.form_definition_is_valid(jsonb, boolean) from public, anon, authenticated;
revoke all on function app.form_answers_problem(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.form_slug_for(uuid, text) from public, anon, authenticated;
revoke all on function app.form_default_definition(text) from public, anon, authenticated;

revoke all on function public.create_form(uuid, text, text) from public;
revoke all on function public.list_forms(uuid) from public;
revoke all on function public.form_editor_state(uuid, uuid) from public;
revoke all on function public.rename_form(uuid, uuid, text) from public;
revoke all on function public.create_form_draft(uuid, uuid) from public;
revoke all on function public.save_form_draft(uuid, uuid, jsonb) from public;
revoke all on function public.publish_form_revision(uuid, uuid) from public;
revoke all on function public.set_form_archived(uuid, uuid, boolean) from public;
revoke all on function public.list_form_submissions(uuid, uuid, integer) from public;
revoke all on function public.list_form_templates() from public;
revoke all on function public.published_form(text, text) from public;
revoke all on function public.submit_public_form(text, text, uuid, jsonb) from public;

grant execute on function public.create_form(uuid, text, text) to authenticated;
grant execute on function public.list_forms(uuid) to authenticated;
grant execute on function public.form_editor_state(uuid, uuid) to authenticated;
grant execute on function public.rename_form(uuid, uuid, text) to authenticated;
grant execute on function public.create_form_draft(uuid, uuid) to authenticated;
grant execute on function public.save_form_draft(uuid, uuid, jsonb) to authenticated;
grant execute on function public.publish_form_revision(uuid, uuid) to authenticated;
grant execute on function public.set_form_archived(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_form_submissions(uuid, uuid, integer) to authenticated;
grant execute on function public.list_form_templates() to authenticated;
grant execute on function public.published_form(text, text) to anon, authenticated;
grant execute on function public.submit_public_form(text, text, uuid, jsonb) to authenticated;

comment on function public.publish_form_revision(uuid, uuid) is
  'The only publish transition: archives the previous immutable revision, advances the form''s pointer, and records who did it, in one transaction.';
comment on function public.published_form(text, text) is
  'The entire anonymous read boundary for forms: one published revision and the business''s public identity, resolved from slugs. It cannot name a tenant by id and cannot expose a draft.';
comment on function public.submit_public_form(text, text, uuid, jsonb) is
  'A visitor''s only write. Resolves the business and form from the public address, requires the revision the visitor saw to still be the published one, validates answers against exactly that revision, and records form.submitted.';

-- Contact forms are now something a business can build and publish.
update public.platform_catalog_features set implementation_state = 'available'
 where key = 'contact_forms'
   and module_id = (select m.id from public.platform_catalog_modules m where m.key = 'forms_intake');
