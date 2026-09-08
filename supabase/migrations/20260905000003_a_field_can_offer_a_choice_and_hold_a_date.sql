-- A field can offer a choice, and can hold a date.
--
-- `field_definitions` has shipped three kinds since M1 -- text, number, boolean -- and the
-- original migration said why the list is short: each kind is a render branch in the domain
-- layer and a validation branch in `app.check_custom_fields`, so a kind with neither is a
-- promise the field editor makes and nothing keeps. That was right, and it has also been the
-- ceiling on what "programming the business through configuration" can actually express.
--
-- **Three kinds means a business configuring itself has no way to say *one of these*.** Every
-- choice list anybody has wanted -- a service level, a machine model, a reason a job was
-- cancelled -- is free text today, which is not a small inconvenience: free text cannot be
-- grouped, so a field a business would report on is the one field this platform cannot report
-- on. `select` is the kind with the most callers waiting for it and none of the problems
-- below.
--
-- Three kinds land here and the reasoning for each is worth keeping, because the ones left
-- out are left out for reasons, not for time.
--
--   * `select`     -- one of a list this business wrote.
--   * `multi_select` -- any number of that same list.
--   * `date`       -- a calendar day, stored as an ISO string.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- **No `currency` kind.** Money in this platform is integer minor units in a currency the
-- business names, and `organizations.currency` is nullable precisely because signing up does
-- not ask. A currency field inside a JSONB blob would be an amount with no currency beside it
-- -- a second money path, unreachable by `priceWorkItem`, invisible to every aggregate, and
-- summable by accident into a number that means nothing. A business that wants to record an
-- amount has a price book; one that wants a number has `number`.
--
-- **No `customer`, `user`, `asset` or `location` kind.** Each is a foreign key, and a foreign
-- key inside `custom` is a foreign key no constraint can see: it would accept another
-- tenant's id, satisfy every policy, and produce a row that joins to nothing. That is
-- precisely the failure the reporting rules already refuse a JSONB filter column over (I18),
-- arriving on the write side instead of the read side. When a business genuinely needs to
-- point at another record, the answer is a typed column with a composite key, which is a
-- migration and should be.
--
-- **No `file` kind.** `documents` is the file axis and it carries storage paths, RLS and an
-- owning entity. A second one inside a JSONB object would be a path with no policy over it.
--
-- **No `formula` kind.** A stored calculation is the thing I4 exists to forbid: it would be a
-- second answer to a question some function already answers, arriving as configuration.
--
-- ---------------------------------------------------------------------------
-- Why options are a column on the definition
-- ---------------------------------------------------------------------------
--
-- A choice list is *what this field is*, not a separate entity: an option has no identity
-- outside its field, is never referenced by anything else, and dies with it. A
-- `field_definition_options` table would buy a second RLS policy, a second grant, ordering,
-- and a join on every form render, in exchange for nothing anybody has asked for.
--
-- Stored as `text[]` rather than JSONB because it is a list of short strings and Postgres can
-- constrain an array's contents directly -- see the check below, which is the whole of what
-- makes an option list well-formed.
--
-- **The stored value is the option text itself, not an index or a generated id.** That is the
-- decision this file would most like to be read: an index makes every stored row depend on the
-- order of a list somebody will reorder, and an id makes a customer's `service_level` an opaque
-- uuid that no report, no export and no human can read. The cost is that renaming an option is
-- not editing an option -- it is defining a new one and leaving the old value where it stands,
-- which is I8 stated in the small: editing today's configuration never rewrites yesterday's
-- rows. `remove` below is what a business does instead, and the value it stops offering stays
-- readable on every row that already carries it.

-- ---------------------------------------------------------------------------
-- The kinds
-- ---------------------------------------------------------------------------

alter table public.field_definitions drop constraint field_definitions_kind_check;

alter table public.field_definitions
  add constraint field_definitions_kind_check
  check (kind in ('text', 'number', 'boolean', 'select', 'multi_select', 'date'));

-- ---------------------------------------------------------------------------
-- The options
-- ---------------------------------------------------------------------------

-- Not null with an empty default, so every existing row is well-formed the moment this applies
-- and nothing has to distinguish "no options" from "options not asked". A text field's empty
-- array is the honest answer: it offers no choices because it is not a choice.
alter table public.field_definitions
  add column options text[] not null default '{}'::text[];

comment on column public.field_definitions.options is
  'The choices a select or multi_select offers, in the order the business put them. Empty for every other kind. The stored value on an entity is the option text itself -- see the migration header for why not an index.';

-- Four rules, and each one is a way an option list stops being usable rather than a matter of
-- taste. A blank option is a choice nobody can name; a duplicate makes two identical entries
-- in a dropdown that select the same value; an over-long one is a label pretending to be a
-- choice; and options on a kind that cannot offer them is a list nothing will ever render.
--
-- **In a function because a CHECK constraint may not contain a subquery**, and every one of
-- these rules is a statement about the array's contents that needs `unnest`. That is a
-- limitation of CHECK rather than a design choice, so the function is the constraint written
-- somewhere it is allowed to be -- `immutable`, taking only the two columns it reads, and
-- called by nothing else.
create function app.field_options_well_formed(p_kind text, p_options text[])
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_kind in ('select', 'multi_select') then
      cardinality(p_options) between 1 and 50
      and array_position(p_options, null) is null
      and not exists (
        select 1 from unnest(p_options) as o (value)
         where length(btrim(o.value)) = 0 or length(o.value) > 64
      )
      and cardinality(p_options) = (
        select count(distinct o.value) from unnest(p_options) as o (value)
      )
    else cardinality(p_options) = 0
  end;
$fn$;

alter table public.field_definitions
  add constraint field_definitions_options_well_formed
  check (app.field_options_well_formed(kind, options));

-- **Options are editable and `kind` is still not**, and the pair is the point. A business that
-- adds a fourth service level is not reinterpreting the three values already stored; a business
-- that changes a `select` to a `number` is. The column grant is where that line is drawn,
-- because a policy sees the old row or the new one and never both -- the same division of
-- labour `20260828000004` established for label, required and position.
--
-- Revoked and re-granted by column rather than added to, because a `grant update` is a promise
-- about a column list and re-stating it whole is the only form that cannot drift. CLAUDE.md
-- names this as the mistake found twice.
revoke update on public.field_definitions from authenticated;
grant update (label, required, position, options) on public.field_definitions to authenticated;

-- ---------------------------------------------------------------------------
-- Conformance to the registry
-- ---------------------------------------------------------------------------

-- Replaced whole rather than patched, because the type check is one expression and splitting a
-- guarantee across two migrations is how one of them gets read without the other.
--
-- The three new kinds each check two things where the old three checked one: that the JSON type
-- is right, *and* that the value is one the business actually offers. The second half is what
-- makes `select` a choice rather than a text field with a nicer form -- without it, a direct
-- PostgREST insert stores any string it likes under a key the screen renders as a dropdown, and
-- the dropdown is then a suggestion. Every entity table grants INSERT to authenticated, so that
-- path is real and not hypothetical, which is the same sentence the original registry migration
-- wrote about this function.
create or replace function app.check_custom_fields()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_entity  text := tg_argv[0];
  v_key     text;
  v_def     record;
  v_type    text;
  v_element jsonb;
begin
  -- Every key present must be declared. This is the half that makes `custom` a registry
  -- rather than a junk drawer.
  for v_key in select jsonb_object_keys(new.custom)
  loop
    if not exists (
      select 1
        from public.field_definitions d
       where d.organization_id = new.organization_id
         and d.entity_type = v_entity
         and d.key = v_key
    ) then
      raise exception 'no field named % is defined for %', v_key, v_entity
        using errcode = '23514';
    end if;
  end loop;

  -- Every declared field must be present if required, and well-typed if present.
  for v_def in
    select d.key, d.kind, d.required, d.options
      from public.field_definitions d
     where d.organization_id = new.organization_id
       and d.entity_type = v_entity
  loop
    v_type := jsonb_typeof(new.custom -> v_def.key);

    if v_type is null or v_type = 'null' then
      if v_def.required then
        raise exception 'field % is required', v_def.key
          using errcode = '23514';
      end if;
      continue;
    end if;

    -- An empty multi_select is nothing chosen, which is the same as absent. Refusing it would
    -- make "tick nothing" impossible to express and "untick everything" impossible to save.
    if v_def.kind = 'multi_select' and v_type = 'array'
       and jsonb_array_length(new.custom -> v_def.key) = 0 then
      if v_def.required then
        raise exception 'field % is required', v_def.key
          using errcode = '23514';
      end if;
      continue;
    end if;

    if (v_def.kind = 'text' and v_type <> 'string')
      or (v_def.kind = 'number' and v_type <> 'number')
      or (v_def.kind = 'boolean' and v_type <> 'boolean')
      or (v_def.kind = 'select' and v_type <> 'string')
      or (v_def.kind = 'date' and v_type <> 'string')
      or (v_def.kind = 'multi_select' and v_type <> 'array')
    then
      raise exception 'field % expects %, got %', v_def.key, v_def.kind, v_type
        using errcode = '23514';
    end if;

    if v_def.kind = 'select'
       and not ((new.custom ->> v_def.key) = any (v_def.options)) then
      raise exception 'field % does not offer %', v_def.key, new.custom ->> v_def.key
        using errcode = '23514';
    end if;

    if v_def.kind = 'multi_select' then
      for v_element in select jsonb_array_elements(new.custom -> v_def.key)
      loop
        if jsonb_typeof(v_element) <> 'string' then
          raise exception 'field % expects a list of choices', v_def.key
            using errcode = '23514';
        end if;
        if not ((v_element #>> '{}') = any (v_def.options)) then
          raise exception 'field % does not offer %', v_def.key, v_element #>> '{}'
            using errcode = '23514';
        end if;
      end loop;
    end if;

    -- **A date is checked twice, and neither check is redundant.** The pattern settles the
    -- shape and the cast settles whether the day exists: a regex accepts 2026-02-31, and a
    -- bare cast accepts 03/04/2026 -- which is a real date and is either March or April
    -- depending on a session setting this platform never wants to depend on. Together they
    -- admit exactly one spelling of exactly the real days.
    --
    -- The cast is thrown away. What is stored is the string the business sent, so a value
    -- never silently changes shape between being written and being read back, and two dates
    -- stored here sort against each other as text exactly as they would as dates.
    if v_def.kind = 'date' then
      if (new.custom ->> v_def.key) !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'field % expects a date as YYYY-MM-DD, got %',
          v_def.key, new.custom ->> v_def.key
          using errcode = '23514';
      end if;
      begin
        perform (new.custom ->> v_def.key)::date;
      exception when others then
        raise exception 'field % is not a real date: %',
          v_def.key, new.custom ->> v_def.key
          using errcode = '23514';
      end;
    end if;
  end loop;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Defining and editing, with the options carried
-- ---------------------------------------------------------------------------

-- Both functions gain one parameter, and both are dropped rather than replaced: adding an
-- argument changes the signature, and CREATE OR REPLACE would leave the shorter version behind
-- as an overload that writes no options at all. Same reasoning as `create_customer` in
-- 20260826000003.
drop function public.create_field_definition(uuid, text, text, text, text, boolean);

create function public.create_field_definition(
  p_organization_id uuid,
  p_entity_type     text,
  p_key             text,
  p_label           text,
  p_kind            text,
  p_required        boolean,
  p_options         text[]
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_id       uuid;
  v_position integer;
begin
  if v_actor is null then
    raise exception 'create_field_definition requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Reads through RLS as the caller, so this cannot count another tenant's fields.
  select coalesce(max(position) + 1, 0) into v_position
    from public.field_definitions
   where organization_id = p_organization_id
     and entity_type = p_entity_type;

  insert into public.field_definitions
    (organization_id, entity_type, key, label, kind, required, position, options, created_by)
  values
    (p_organization_id, p_entity_type, p_key, p_label, p_kind, p_required, v_position,
     coalesce(p_options, '{}'::text[]), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'field_definition', v_id, 'field_definition.created',
     jsonb_build_object('entity_type', p_entity_type, 'key', p_key, 'kind', p_kind));

  return v_id;
end;
$fn$;

revoke all on function public.create_field_definition(uuid, text, text, text, text, boolean, text[]) from public;
grant execute on function public.create_field_definition(uuid, text, text, text, text, boolean, text[]) to authenticated;

drop function public.update_field_definition(uuid, text, boolean, integer);

create function public.update_field_definition(
  p_id       uuid,
  p_label    text,
  p_required boolean,
  p_position integer,
  p_options  text[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'update_field_definition requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Making a field required does not reach back: app.check_custom_fields fires on write only,
  -- so entities that already exist without it stay valid until something edits them. The same
  -- is true of removing an option -- rows already carrying it keep it, and only the next write
  -- to one of those rows is refused. That asymmetry is deliberate and is I8: configuration
  -- changes what happens next, never what already happened.
  update public.field_definitions
     set label    = p_label,
         required = p_required,
         position = p_position,
         options  = coalesce(p_options, '{}'::text[])
   where id = p_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'no such field, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'field_definition', p_id, 'field_definition.updated',
     jsonb_build_object('label', p_label, 'required', p_required, 'position', p_position));
end;
$fn$;

revoke all on function public.update_field_definition(uuid, text, boolean, integer, text[]) from public;
grant execute on function public.update_field_definition(uuid, text, boolean, integer, text[]) to authenticated;
