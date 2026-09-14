-- Activation, the second of four independent axes named in the canonical model (entitlement,
-- activation, readiness, authorization -- domain-model.md). Entitlement says what GOLD provides;
-- this table says whether a tenant has deliberately turned an entitled, ordinary capability off.
--
-- **Opt-out, not opt-in.** An entitled feature is active by default; a row here is the tenant
-- overriding that default toward "off". Absence of a row is not "undecided" -- it is "on", the
-- same shape `organization_modules` already uses for the wanted axis one table over (D25).
--
-- Role authorization is a separate axis again and is never consulted here, and this table is
-- never consulted by any RLS policy that decides authorization -- the same separation D25 drew
-- between `organization_modules` and `app.has_capability`.

-- ---------------------------------------------------------------------------
-- feature.manage, the capability that guards this table
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'customer.update',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create',
    'work_item.transition',
    'work_item.schedule',
    'work_item.record',
    'organization.manage',
    'price.manage',
    'work_item.price',
    'work_item.update',
    'invoice.issue',
    'payment.record',
    'automation.manage',
    'configuration.propose',
    'assistant.ask',
    'report.read',
    'report.manage',
    'call.place',
    'integration.manage',
    'feature.manage'
  ]::text[]);

-- Every role that already holds `organization.manage` gets `feature.manage` alongside it, the
-- same backfill `integration.manage` received one migration ago and for the same reason: a
-- business that wants somebody else to hold this grants it apart from `organization.manage`
-- going forward, and this only carries forward what already exists.
update public.roles
   set capabilities = capabilities || array['feature.manage']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('feature.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- organization_feature_activation_overrides
-- ---------------------------------------------------------------------------

create table public.organization_feature_activation_overrides (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  feature_id      uuid        not null references public.platform_catalog_features (id),
  disabled_at     timestamptz not null default now(),
  disabled_by     uuid        not null references auth.users (id),

  -- I2: leads with organization_id. One row per (business, feature) -- a second disable is a
  -- no-op, matched by `disableOrganizationFeature`'s own idempotence rather than a second row.
  primary key (organization_id, feature_id)
);

comment on table public.organization_feature_activation_overrides is
  'A tenant''s deliberate opt-out of an entitled, otherwise-active feature. A row means disabled; '
  'absence means active. Never consulted by any RLS policy deciding authorization -- entitlement, '
  'activation, readiness and role authorization stay four independent questions (domain-model.md).';

alter table public.organization_feature_activation_overrides enable row level security;
alter table public.organization_feature_activation_overrides force row level security;

create policy organization_feature_activation_overrides_select
  on public.organization_feature_activation_overrides
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy organization_feature_activation_overrides_insert
  on public.organization_feature_activation_overrides
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and disabled_by = (select auth.uid())
    and app.has_capability(organization_id, 'feature.manage')
  );

create policy organization_feature_activation_overrides_delete
  on public.organization_feature_activation_overrides
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'feature.manage')
  );

-- No update policy, the same reasoning `organization_modules` gives: re-enabling is deleting the
-- row, not editing it, so the fact that it was once disabled is never overwritten in place.
grant select, insert, delete on public.organization_feature_activation_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- Classifying one (organization, canonical feature) pair against the legacy module axis
-- ---------------------------------------------------------------------------

-- A canonical Feature reaches the legacy module system through zero or more `module_key`
-- runtime mappings. Most features map to exactly one; a few share a module_key with other
-- features. This returns the D41 state -- 'wanted_paid', 'unwanted_paid', or 'other' (covering
-- both "wanted but unpaid" and "neither", both of which the backfill treats identically: never
-- entitled, nothing to preserve) -- or raises if a feature's several module_key mappings
-- disagree, which would make "was this feature deliberately switched off" unanswerable from
-- the legacy data alone.
--
-- `organization_commercial_terms_no_overlap`, a gist exclusion one migration up, already makes
-- two currently-paid terms for the same (organization, product_key) structurally impossible, so
-- the one remaining way this can fail is exactly the multi-mapping disagreement checked here.
create function app.classify_feature_module_state(p_organization_id uuid, p_feature_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_state      text;
  v_prev_state text := null;
  v_row        record;
begin
  for v_row in
    select
      case
        when w.module_key is not null and p.module_key is not null then 'wanted_paid'
        when w.module_key is null     and p.module_key is not null then 'unwanted_paid'
        else 'other'
      end as state
    from public.platform_catalog_runtime_mappings rm
    left join lateral (
      select m.module_key from public.organization_modules m
       where m.organization_id = p_organization_id and m.module_key = rm.mapping_value
    ) w on true
    left join lateral (
      select t.product_key from public.organization_commercial_terms t
       where t.organization_id = p_organization_id
         and t.product_key = 'module:' || rm.mapping_value
         and t.period_start <= current_date
         and t.period_end   >  current_date
    ) p on true
    where rm.feature_id = p_feature_id
      and rm.mapping_kind = 'module_key'
  loop
    v_state := v_row.state;
    if v_prev_state is not null and v_prev_state <> v_state then
      raise exception
        'feature % maps to module keys with conflicting commercial state for organization % (% vs %) -- cannot classify deterministically',
        p_feature_id, p_organization_id, v_prev_state, v_state
        using errcode = '22023';
    end if;
    v_prev_state := v_state;
  end loop;

  return v_prev_state;
end;
$fn$;

comment on function app.classify_feature_module_state(uuid, uuid) is
  'The D41 state of one canonical feature for one organization, read through its module_key '
  'runtime mappings. Null means the feature has no module_key mapping at all. Raises rather than '
  'guessing when a feature''s several mappings disagree.';

revoke all on function app.classify_feature_module_state(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Backfill: preserve every deliberate deactivation the legacy module system already recorded
-- ---------------------------------------------------------------------------

-- Only the "paid but switched off" state is independent evidence of a deliberate deactivation --
-- a staff-recorded paid commercial term with no corresponding "on" row. Every other state (on
-- and paid; never entitled either way) needs no override: the resolver treats "entitled and no
-- override" as active, and "never entitled" as unavailable regardless of the override table.
do $$
declare
  v_pair   record;
  v_state  text;
  v_actor  uuid;
begin
  for v_pair in
    select f.id as feature_id, f.key as feature_key, o.id as organization_id
      from public.platform_catalog_features f
      cross join public.organizations o
     where exists (
       select 1 from public.platform_catalog_runtime_mappings rm
        where rm.feature_id = f.id and rm.mapping_kind = 'module_key'
     )
  loop
    v_state := app.classify_feature_module_state(v_pair.organization_id, v_pair.feature_id);

    if v_state = 'unwanted_paid' then
      select ms.user_id into v_actor
        from public.memberships ms
       where ms.organization_id = v_pair.organization_id
       order by ms.created_at
       limit 1;

      if v_actor is null then
        raise exception
          'organization % has a paid, switched-off legacy module backing feature % but no membership to attribute the backfilled deactivation to',
          v_pair.organization_id, v_pair.feature_key
          using errcode = '22023';
      end if;

      insert into public.organization_feature_activation_overrides
        (organization_id, feature_id, disabled_by)
      values (v_pair.organization_id, v_pair.feature_id, v_actor)
      on conflict do nothing;
    end if;
  end loop;
end $$;
