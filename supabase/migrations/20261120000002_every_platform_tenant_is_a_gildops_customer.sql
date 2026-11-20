-- Every business GildOps serves is one of GildOps' customers (ADR-057, decision 5).
--
-- A subscription GildOps records in its own Finance names a customer in GildOps' CRM, and reaches
-- the business it switches features on for through a client–tenant relationship. Businesses that
-- reached a plan or a platform subscription without a proposal handoff (provisioned from Platform,
-- or before handoffs existed) have neither. This migration gives each of them one: a company
-- contact in GildOps' organization named after the business, and an active relationship whose
-- origin is `migration`.
--
-- Nothing is guessed: no email or phone is copied, no existing contact is matched by name, and an
-- ended relationship's customer is reused rather than duplicated. The `customer.created` event
-- payload carries `origin: migration` so duplicates of a contact GildOps already had can be listed
-- and merged by a person.
--
-- `app.link_platform_customers()` is kept so later steps and tests can run it again; it links only
-- what is still unlinked and returns how many relationships it created. With no operating
-- organization configured it does nothing: there is no seller to link to.

alter table public.client_tenant_relationships drop constraint client_tenant_relationships_origin_check;
alter table public.client_tenant_relationships add constraint client_tenant_relationships_origin_check
  check (origin in ('proposal_handoff', 'existing_tenant_link', 'migration'));

create function app.link_platform_customers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := app.operating_organization_id();
  v_fallback_actor uuid;
  v_tenant record;
  v_actor uuid;
  v_customer uuid;
  v_relationship uuid;
  v_created integer := 0;
begin
  if v_seller is null then
    return 0;
  end if;

  -- Who a record is attributed to when the tenant's own history names nobody: the earliest member
  -- of GildOps' organization who manages roles.
  select m.user_id into v_fallback_actor
    from public.memberships m
    join public.roles r on r.id = m.role_id
   where m.organization_id = v_seller and 'role.manage' = any (r.capabilities)
   order by m.created_at, m.user_id
   limit 1;

  for v_tenant in
    select t.organization_id, o.name
      from (select organization_id from public.organization_plan_assignments
            union select organization_id from public.organization_platform_subscriptions
            union select organization_id from public.platform_billing_customers) t
      join public.organizations o on o.id = t.organization_id
     where t.organization_id <> v_seller
       and not exists (
         select 1 from public.client_tenant_relationships r
          where r.organization_id = v_seller and r.tenant_organization_id = t.organization_id and r.status = 'active')
     order by o.created_at, o.id
  loop
    v_actor := coalesce(
      (select a.assigned_by from public.organization_plan_assignments a
        where a.organization_id = v_tenant.organization_id order by a.assigned_at, a.id limit 1),
      (select c.created_by from public.platform_billing_customers c
        where c.organization_id = v_tenant.organization_id order by c.created_at, c.id limit 1),
      v_fallback_actor);
    if v_actor is null then
      raise exception 'No one to attribute GildOps customer % to: GildOps has no role manager', v_tenant.organization_id
        using errcode = '55000';
    end if;

    -- Reuse the customer of an ended relationship with the same business before creating one.
    select r.customer_id into v_customer
      from public.client_tenant_relationships r
     where r.organization_id = v_seller and r.tenant_organization_id = v_tenant.organization_id
     order by r.created_at desc, r.id
     limit 1;

    if v_customer is null then
      insert into public.contacts (organization_id, name, contact_type, lifecycle, custom, created_by)
      values (v_seller, left(btrim(v_tenant.name), 200), 'company', 'customer', '{}'::jsonb, v_actor)
      returning id into v_customer;
      insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
      values (v_seller, v_actor, 'customer', v_customer, 'customer.created',
              jsonb_build_object('origin', 'migration', 'tenantOrganizationId', v_tenant.organization_id));
    end if;

    insert into public.client_tenant_relationships
      (organization_id, customer_id, tenant_organization_id, origin, authority_basis, created_by)
    values (v_seller, v_customer, v_tenant.organization_id, 'migration',
            'Existing GildOps plan assignment or platform subscription recorded before Finance owned GildOps selling',
            v_actor)
    returning id into v_relationship;
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (v_seller, v_actor, 'customer', v_customer, 'client_tenant.linked',
            jsonb_build_object('relationshipId', v_relationship, 'tenantId', v_tenant.organization_id, 'origin', 'migration'));

    v_created := v_created + 1;
  end loop;

  return v_created;
end $$;
revoke all on function app.link_platform_customers() from public, anon, authenticated;
comment on function app.link_platform_customers() is
  'Links every business with a GildOps plan or platform subscription to a customer in GildOps'' CRM (ADR-057). Idempotent; returns relationships created. No client grant.';

select app.link_platform_customers();

-- Verification: nothing is left unlinked, and a second run creates nothing.
do $$
declare v_unlinked int; v_again int;
begin
  if app.operating_organization_id() is null then
    return;
  end if;
  select count(*) into v_unlinked
    from (select organization_id from public.organization_plan_assignments
          union select organization_id from public.organization_platform_subscriptions
          union select organization_id from public.platform_billing_customers) t
   where t.organization_id <> app.operating_organization_id()
     and not exists (select 1 from public.client_tenant_relationships r
                      where r.organization_id = app.operating_organization_id()
                        and r.tenant_organization_id = t.organization_id and r.status = 'active');
  if v_unlinked > 0 then raise exception '% GildOps buyers remain without a customer link', v_unlinked; end if;
  v_again := app.link_platform_customers();
  if v_again <> 0 then raise exception 'linking GildOps customers is not idempotent (% more on a second run)', v_again; end if;
end $$;
