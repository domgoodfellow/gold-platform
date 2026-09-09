-- A public prospect asking GOLD for a workflow review, written as an ordinary customer of GOLD's
-- own tenant (D42) rather than as a second CRM this platform would then have to maintain forever.
--
-- **Why this is narrower than booking, not the same shape.** `create_booking` (D22) lets a
-- stranger read back the one row they created, because a booking confirmation has to show what
-- was booked. A workflow review has no such need, and the slice that asked for this said so
-- explicitly: after submitting, the prospect must not be able to read the customer just written,
-- enumerate organizations, or reach anything else in GOLD's own tenant. So there is no
-- `external_actors` binding here at all -- that table exists to answer "which tenant is this
-- session scoped to" for a *select* policy, and the one thing this axis must never grant is a
-- select policy. Anonymous sign-in still happens (I11: a real `auth.users` row, same as booking),
-- but nothing durable is built on top of it, and the caller signs out again the moment the
-- request succeeds (`lib/domain/workflow-review/workflow-review.ts`).
--
-- **Why GOLD's organization id cannot be a parameter.** `create_booking` accepts
-- `p_organization_id` from its caller, but only because it re-derives the true scope from
-- `app.current_external_tenant()` (the caller's own binding row) and refuses any mismatch -- the
-- parameter never authorizes anything by itself. This function has no binding to check a
-- parameter against, so accepting one directly would let any signed-in caller (anonymous or
-- otherwise) name an arbitrary organization and plant a row in a tenant that never asked for one,
-- straight through PostgREST. D17's rule -- tenant identity resolved server-side, never accepted
-- from the caller -- applies just as it does to a URL, so the target lives in a table this
-- function reads and no grant lets anyone else read or write.
--
-- **Why not an environment variable.** A Postgres function cannot read one, and passing an
-- env-sourced value in from `apps/web` would still be a caller-supplied parameter as far as this
-- function could tell -- the trust would live in the wrong layer. D42 already settled this for
-- module grants: "a migration cannot name an organization id that only exists in one deployment,"
-- so the value is set by hand, once per deployment, by a snippet -- never by a migration, and
-- never by anything this function's own caller provides.
create table public.platform_settings (
  singleton boolean primary key default true,
  constraint platform_settings_is_a_singleton check (singleton),
  workflow_review_organization_id uuid references public.organizations (id)
);

comment on table public.platform_settings is
  'Deployment-wide configuration with no tenant to belong to -- one row, never read or written through PostgREST by any role. Set by hand: supabase/snippets/workflow-review-target.sql.';

insert into public.platform_settings (singleton) values (true);

-- Same posture as platform_staff (D28): RLS enabled and forced, and deliberately no policy for
-- `authenticated` or `anon` -- the only reader is the SECURITY DEFINER function below, which
-- bypasses RLS entirely rather than needing a grant.
alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;

-- ---------------------------------------------------------------------------
-- The one write this axis may perform
-- ---------------------------------------------------------------------------

create function public.request_workflow_review(
  p_name          text,
  p_business_name text,
  p_email         text,
  p_phone         text,
  p_context       text,
  p_team_size     text,
  p_business_type text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_target uuid;
  v_name   text := btrim(p_business_name);
  v_customer uuid;
begin
  if v_actor is null then
    raise exception 'request_workflow_review requires an authenticated caller'
      using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'a business name is required'
      using errcode = '23514';
  end if;

  select workflow_review_organization_id into v_target
  from public.platform_settings
  where singleton;

  -- Honest absence (D31): a deployment that has not run the snippet takes no request rather
  -- than filing one nobody will ever see.
  if v_target is null then
    raise exception 'workflow review intake is not configured on this deployment'
      using errcode = 'GD001';
  end if;

  insert into public.customers (organization_id, name, email, phone, created_by)
  values (
    v_target,
    v_name,
    nullif(btrim(p_email), ''),
    nullif(btrim(p_phone), ''),
    v_actor
  )
  returning id into v_customer;

  -- Reuses the existing vocabulary (`customer.created`, read by `listCustomerTimeline` and
  -- `listRecentActivity`) rather than teaching the timeline a second verb for what is, from
  -- GOLD's own operator's chair, an ordinary new customer. Everything the form asked for beyond
  -- the customer's own columns -- who to ask for, what they described, the two optional
  -- qualifiers -- travels in the payload, same as `create_booking` carries what a booking's own
  -- columns cannot.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    v_target,
    v_actor,
    'customer',
    v_customer,
    'customer.created',
    jsonb_build_object(
      'name', v_name,
      'source', 'workflow_review',
      'contact_name', nullif(btrim(p_name), ''),
      'context', nullif(btrim(p_context), ''),
      'team_size', nullif(btrim(p_team_size), ''),
      'business_type', nullif(btrim(p_business_type), '')
    )
  );
end;
$fn$;

comment on function public.request_workflow_review(text, text, text, text, text, text, text) is
  'The only write a public workflow-review submission may perform. One customer row in GOLD''s own tenant, resolved from platform_settings rather than from anything the caller supplies (D17, D42) -- and no select policy anywhere grants the caller a way to read it back afterward.';

revoke all on function public.request_workflow_review(text, text, text, text, text, text, text) from public;
grant execute on function public.request_workflow_review(text, text, text, text, text, text, text) to authenticated;
