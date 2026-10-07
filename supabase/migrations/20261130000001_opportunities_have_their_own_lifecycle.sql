-- A relationship can have several independently closing pieces of potential business.
-- Customer.stage_id stays relationship state. Neither Finance nor proposals are changed.
do $$
declare v_known text[]; v_constraint text;
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_known from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  v_known := v_known || array['opportunity.create', 'opportunity.update'];
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',') from unnest(v_known) c));
end $$;
-- Backfill administrators, not every role allowed to correct customer identity.
update public.roles set capabilities = capabilities || array['opportunity.create', 'opportunity.update']
  where 'organization.manage' = any(capabilities);

create table public.opportunity_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 64),
  position integer not null default 0 check (position >= 0),
  kind text not null check (kind in ('open', 'won', 'lost')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (organization_id, id)
);
create unique index opportunity_stages_org_name on public.opportunity_stages(organization_id, lower(name));
create unique index opportunity_stages_org_terminal on public.opportunity_stages(organization_id, kind) where kind in ('won', 'lost');
create index opportunity_stages_org_position on public.opportunity_stages(organization_id, position, created_at);
alter table public.opportunity_stages enable row level security;
alter table public.opportunity_stages force row level security;
create policy opportunity_stages_read on public.opportunity_stages for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));
create policy opportunity_stages_create on public.opportunity_stages for insert to authenticated
  with check (organization_id in (select app.current_tenant_ids()) and created_by = (select auth.uid()) and app.has_capability(organization_id, 'field.manage'));
create policy opportunity_stages_update on public.opportunity_stages for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'));
grant select on public.opportunity_stages to authenticated;
grant insert (organization_id, name, position, kind, created_by) on public.opportunity_stages to authenticated;
grant update (name, position, kind) on public.opportunity_stages to authenticated;

-- Composite references enforce the tenant boundary independently of RLS and caller code.
-- These referenced tenant-leading keys already exist for Customers and Memberships.
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  stage_id uuid,
  amount_minor bigint check (amount_minor between 0 and 9007199254740991),
  currency text check (currency ~ '^[A-Z]{3}$'),
  owner_membership_id uuid,
  expected_close_on date,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  constraint opportunities_value_pair check ((amount_minor is null) = (currency is null)),
  constraint opportunities_customer_same_org foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  constraint opportunities_stage_same_org foreign key (organization_id, stage_id) references public.opportunity_stages(organization_id, id),
  constraint opportunities_owner_same_org foreign key (organization_id, owner_membership_id) references public.memberships(organization_id, id) on delete set null (owner_membership_id)
);
create index opportunities_org_created on public.opportunities(organization_id, created_at desc, id);
create index opportunities_org_customer on public.opportunities(organization_id, customer_id, created_at desc);
create index opportunities_org_stage on public.opportunities(organization_id, stage_id, created_at desc);
create index opportunities_org_owner on public.opportunities(organization_id, owner_membership_id, created_at desc) where owner_membership_id is not null;
alter table public.opportunities enable row level security;
alter table public.opportunities force row level security;
create policy opportunities_read on public.opportunities for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));
create policy opportunities_create on public.opportunities for insert to authenticated
  with check (organization_id in (select app.current_tenant_ids()) and created_by = (select auth.uid()) and app.has_capability(organization_id, 'opportunity.create'));
create policy opportunities_update on public.opportunities for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'opportunity.update'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'opportunity.update'));
grant select on public.opportunities to authenticated;
grant insert (organization_id, customer_id, title, stage_id, amount_minor, currency, owner_membership_id, expected_close_on, created_by) on public.opportunities to authenticated;
grant update (title, stage_id, amount_minor, currency, owner_membership_id, expected_close_on) on public.opportunities to authenticated;

-- The same immutable event log used by Customers. A raw authorized table write cannot omit it.
-- SECURITY INVOKER: no privileged bypass. Lock stage vocabulary before using its semantic kind,
-- serializing against reclassification; event payloads preserve the words and terms at the time.
create function app.observe_opportunity() returns trigger language plpgsql set search_path = '' as $$
declare v_stage public.opportunity_stages; v_payload jsonb;
begin
  if new.stage_id is not null then
    select * into v_stage from public.opportunity_stages
      where organization_id = new.organization_id and id = new.stage_id for share;
  end if;
  v_payload := jsonb_build_object('customer_id', new.customer_id, 'title', new.title,
    'stage_id', new.stage_id, 'stage_name', v_stage.name, 'stage_kind', v_stage.kind,
    'amount_minor', new.amount_minor, 'currency', new.currency,
    'owner_membership_id', new.owner_membership_id, 'expected_close_on', new.expected_close_on);
  if tg_op = 'INSERT' then
    insert into public.events(organization_id, actor_id, entity_type, entity_id, action, payload)
      values(new.organization_id, auth.uid(), 'opportunity', new.id, 'opportunity.created', v_payload);
  elsif new is distinct from old then
    insert into public.events(organization_id, actor_id, entity_type, entity_id, action, payload)
      values(new.organization_id, auth.uid(), 'opportunity', new.id, 'opportunity.updated',
        v_payload || jsonb_build_object('before', to_jsonb(old)));
    if new.stage_id is distinct from old.stage_id then
      insert into public.events(organization_id, actor_id, entity_type, entity_id, action, payload)
        values(new.organization_id, auth.uid(), 'opportunity', new.id, 'opportunity.stage_changed',
          v_payload || jsonb_build_object('from_stage_id', old.stage_id, 'to_stage_id', new.stage_id));
    end if;
  end if;
  return new;
end $$;
create trigger opportunity_observed before insert or update on public.opportunities for each row execute function app.observe_opportunity();
revoke all on function app.observe_opportunity() from public;

-- Once used, kind is historical semantics, even after every opportunity moves away.
create function app.protect_opportunity_stage_kind() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind and exists (
    select 1 from public.events where organization_id = old.organization_id and entity_type = 'opportunity'
      and payload->>'stage_id' = old.id::text
  ) then
    raise exception 'A stage used by an opportunity cannot change its lifecycle kind.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger opportunity_stage_semantics before update on public.opportunity_stages for each row execute function app.protect_opportunity_stage_kind();
revoke all on function app.protect_opportunity_stage_kind() from public;
create index events_org_opportunity_stage on public.events(organization_id, (payload->>'stage_id')) where entity_type = 'opportunity';

-- One CRM aggregate; exact counts and exact integer value totals, separated by currency.
-- Text totals avoid JavaScript precision loss when adding many individually safe amounts.
create function public.opportunity_stage_summary(p_organization_id uuid)
returns table(stage_id uuid, stage_name text, stage_kind text, stage_position integer, currency text, opportunity_count bigint, value_minor text)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.name, s.kind, s.position, o.currency, count(o.id), sum(o.amount_minor)::text
    from public.opportunity_stages s left join public.opportunities o on o.organization_id = s.organization_id and o.stage_id = s.id
    where s.organization_id = p_organization_id
    group by s.id, s.name, s.kind, s.position, o.currency
  union all
  select null::uuid, 'Unstaged', null::text, null::integer, o.currency, count(o.id), sum(o.amount_minor)::text
    from public.opportunities o where o.organization_id = p_organization_id and o.stage_id is null group by o.currency
$$;
revoke all on function public.opportunity_stage_summary(uuid) from public;
grant execute on function public.opportunity_stage_summary(uuid) to authenticated;
comment on table public.opportunities is 'One potential piece of business with a Customer, independent of relationship stage, proposals and Finance. No deletion lifecycle.';
comment on table public.opportunity_stages is 'Tenant vocabulary; open/won/lost is explicit semantics. No stages are seeded; kind cannot change after historical use.';

-- Extend the existing projection, using immutable customer attribution from Opportunity events.
create or replace view public.customer_activity with (security_invoker = true) as
  select e.organization_id, coalesce(c.id, w.customer_id,
    case
      when e.entity_type = 'opportunity' or e.action = 'location.linked' or (e.action = 'document.created' and e.payload ? 'customer_id') then (e.payload->>'customer_id')::uuid
      when e.action = 'document.created' and e.payload ? 'work_item_id' then
        (select wi.customer_id from public.work_items wi where wi.organization_id = e.organization_id and wi.id = (e.payload->>'work_item_id')::uuid)
    end) as customer_id,
    e.id as event_id, e.action, e.entity_type, e.entity_id, e.payload, e.actor_id, e.occurred_at
    from public.events e left join public.customers c on c.organization_id = e.organization_id and c.id = e.entity_id
    left join public.work_items w on w.organization_id = e.organization_id and w.id = e.entity_id;
notify pgrst, 'reload schema';
