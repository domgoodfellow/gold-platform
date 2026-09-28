-- Slice 0B: a schedulable Resource may optionally represent one tenant Membership.
--
-- This is the prerequisite Slice 0A named and did not build: "own schedule" cannot be a real
-- authorization scope while a Resource carries no identity link back to the person it is. This
-- migration adds exactly that link, and nothing else -- no Schedule visibility change, no Team,
-- no HR data. `membership_id is null` still means "not a GildOps member" (a van, a room, a
-- machine, an outside contractor with no account) -- resources.sql's own two deliberate
-- absences (no `kind`, no `active`) are untouched.
--
-- Linked to a Membership, not to `auth.users`, for the same reason every other tenant-facing
-- identity in this schema is (D19): a Membership is the per-tenant fact ("this business calls
-- this person Sam"), and it is what makes a same-organization guarantee possible to write down
-- at all -- `auth.users` carries no organization.

-- ---------------------------------------------------------------------------
-- The column and the composite FK
-- ---------------------------------------------------------------------------

-- The target side of the composite FK below -- `memberships (organization_id, id)` -- already
-- exists as `memberships_org_id_unique` (`20260922000002_phone_number_inventory.sql`, added for
-- phone number ownership's own composite reference). Checked rather than assumed: it is not
-- resources.sql's `resources_org_id_unique`, which is a different table's constraint of the
-- same shape.

alter table public.resources
  add column membership_id uuid null;

-- Composite, leading `organization_id` (I2, I18) -- the same shape `memberships_role_same_org`
-- already uses one table over: a Resource cannot be pointed at another tenant's Membership,
-- and nothing anywhere needs to check that separately.
--
-- `on delete set null (membership_id)` -- PostgreSQL 15+ syntax, targeting only the optional
-- identity column rather than the whole composite key. `resources.organization_id` is `not
-- null`; a bare `on delete set null` would attempt to null every referencing column, including
-- that one, and fail the not-null constraint the moment a Membership disappeared. This is the
-- smallest correct alternative: the Resource survives, its `organization_id` is never touched,
-- and only the identity link clears. No membership-removal path exists in this codebase today
-- (`add_member_by_email` and `accept_invitation` are the only writers of `memberships`, and
-- neither is a delete), so this action is currently unreachable in production -- it is written
-- now because the FK's delete semantics must be correct before anything can ever call it, not
-- after.
alter table public.resources
  add constraint resources_membership_same_org
  foreign key (organization_id, membership_id)
  references public.memberships (organization_id, id)
  on delete set null (membership_id);

-- One Membership represents at most one Resource, per organization -- tenant-leading, per this
-- repository's own indexing convention (I2), and partial so two unlinked resources (both null)
-- never collide.
create unique index resources_membership_id_unique
  on public.resources (organization_id, membership_id)
  where membership_id is not null;

comment on column public.resources.membership_id is
  'Null: not represented by a GildOps member (a vehicle, a room, a machine, an unaccounted '
  'contractor). Set: this Resource represents that Membership for scheduling purposes. Never '
  'auth.users directly -- see D19.';

-- ---------------------------------------------------------------------------
-- resource.update: correcting a Resource past its name and custom fields
-- ---------------------------------------------------------------------------
--
-- `resource.create` has never had to mean "and may also correct one afterward" because
-- nothing correctable existed. Linking, changing or clearing a Membership is a distinct
-- authority from creating the row in the first place (an operator who may register a new van
-- should not automatically be trusted to reassign who a colleague's Resource represents), so
-- this is a new capability rather than a silent broadening of `resource.create`.
--
-- Read the live constraint rather than assuming its current contents, the same defensive shape
-- `20260926000001` already uses for `billing.manage` -- the list has grown across two dozen
-- migrations since resources.sql last wrote it out in full, and hand-copying it here is exactly
-- how it would drift.
do $$
declare
  v_capabilities text[];
  v_constraint text;
begin
  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass
     and c.conname = 'roles_capabilities_known';

  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[])
    into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  if not ('resource.update' = any (v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'resource.update');

    alter table public.roles drop constraint roles_capabilities_known;
    execute format(
      'alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
      (select string_agg(quote_literal(capability), ', ' order by capability)
         from unnest(v_capabilities) as capability)
    );
  end if;
end
$$;

-- Same reasoning `resource.create` itself was granted with: whoever may register a Resource
-- may also correct it, so a role that already does the one is not left unable to do the other
-- until somebody separately edits it in. Every role without `resource.create` gets nothing new.
update public.roles
   set capabilities = capabilities || array['resource.update']::text[]
 where 'resource.create' = any (capabilities)
   and not ('resource.update' = any (capabilities));

-- ---------------------------------------------------------------------------
-- The write: a narrow grant and policy, exactly `update_role`'s shape -- not a broad Resource
-- UPDATE policy for one field's sake
-- ---------------------------------------------------------------------------

grant update (membership_id) on public.resources to authenticated;

create policy resources_update on public.resources
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'resource.update')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'resource.update')
  );

-- ---------------------------------------------------------------------------
-- set_resource_membership: the one door, SECURITY INVOKER
-- ---------------------------------------------------------------------------
--
-- Mirrors `update_role` exactly: RLS (`resources_update`) and the column grant above are what
-- decide whether this write is allowed, and the composite FK is what refuses a foreign
-- Membership -- both hold regardless of whether this function is used, a direct PostgREST
-- PATCH is used, or a future caller reaches the table any other way. This function adds
-- nothing beyond the transaction boundary and the event; it does not need SECURITY DEFINER and
-- does not get it, so it asserts nothing about authorization itself -- it does not need to.
create function public.set_resource_membership(
  p_resource_id   uuid,
  p_membership_id uuid
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
  update public.resources
     set membership_id = p_membership_id
   where id = p_resource_id
  returning organization_id into v_org;

  -- Null means the row was invisible or the update was refused -- RLS or the missing grant.
  -- Not distinguished from each other, the same way `update_role` does not distinguish them.
  if v_org is null then
    raise exception 'no such resource, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'resource', p_resource_id, 'resource.membership_changed',
     jsonb_build_object('membership_id', p_membership_id));
end;
$fn$;

revoke all on function public.set_resource_membership(uuid, uuid) from public;
grant execute on function public.set_resource_membership(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_resource: linking at creation is the same authority as creating the row
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced, the same reason `create_organization` was in
-- `members.sql`: adding a parameter changes the signature, and CREATE OR REPLACE would leave
-- the three-argument version behind as a second, callable overload.
--
-- No new capability check here -- `resource.create` already governs every other field this
-- function sets on the row it is creating (`name`, `custom`); a Membership chosen at the
-- moment of creation is one more of those fields, not a correction to an existing Resource,
-- which is what `resource.update` exists for instead.
drop function public.create_resource(uuid, text, jsonb);

create function public.create_resource(
  p_organization_id uuid,
  p_name            text,
  p_custom          jsonb,
  p_membership_id   uuid default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_resource requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.resources (organization_id, name, custom, membership_id, created_by)
  values (p_organization_id, p_name, coalesce(p_custom, '{}'::jsonb), p_membership_id, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'resource', v_id, 'resource.created',
     jsonb_build_object('name', p_name, 'membership_id', p_membership_id));

  return v_id;
end;
$fn$;

revoke all on function public.create_resource(uuid, text, jsonb, uuid) from public;
grant execute on function public.create_resource(uuid, text, jsonb, uuid) to authenticated;
