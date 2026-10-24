-- Reconcile a database whose schema drifted from the committed migrations.
--
-- The hosted project records 20261022000075 (portal pages) and 20260923000001 (public
-- communication rate limits) as applied, but holds an earlier draft of both: card-payment entry
-- points that skip the plan entitlement check (and, for availability, the portal invoice check), with
-- availability never moved behind its portal wrapper; two portal function bodies from before review;
-- and the rate-limit table without
-- forced row-level security. Every statement restates the committed end state, so on a database
-- that already matches (every fresh or local one) it changes nothing.

-- Card payments: the internal checks live in app; the public entry points first require the portal
-- to expose invoices and the business to have card payments switched on and entitled.
CREATE OR REPLACE FUNCTION "app"."external_card_payment_availability"("p_invoice_id" "uuid", "p_provider" "text") RETURNS TABLE("outstanding_minor" bigint, "currency" "text", "account_id" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_ctx     record;
  v_account public.payment_accounts;
begin
  select * into v_ctx from app.external_invoice_payment_context(p_invoice_id);

  if v_ctx.organization_id is null or v_ctx.outstanding_minor <= 0 then
    return;
  end if;

  -- The wanted/paid intersection `public.usable_modules` already computes, inlined rather than
  -- called: that function is `security invoker`, reading tables the external axis holds no
  -- policy on at all, and calling it from here would only work by accident of which role happens
  -- to be effective at the call site. Written out, this is the one thing to keep in step with
  -- `20260910000002`'s own definition if that ever changes.
  if not exists (
    select 1
      from public.organization_modules m
      join public.organization_commercial_terms t
        on t.organization_id = m.organization_id
       and t.product_key = 'module:' || m.module_key
       and t.period_start <= current_date
       and t.period_end   >  current_date
     where m.organization_id = v_ctx.organization_id
       and m.module_key = 'card_payments'
  ) then
    return;
  end if;

  select * into v_account
    from public.payment_accounts
   where organization_id = v_ctx.organization_id
     and provider = p_provider;

  if v_account.provider is null then
    -- No fallback account (D27) -- absence here is absence of a Pay action, never a reason to
    -- reach for a platform-owned one.
    return;
  end if;

  return query select v_ctx.outstanding_minor, v_ctx.currency, v_account.account_id;
end;
$$;

COMMENT ON FUNCTION "app"."external_card_payment_availability"("p_invoice_id" "uuid", "p_provider" "text") IS 'Zero or one row: whether the current external customer may pay this invoice by card right now. Read-only -- writes nothing, so a page may call it on every render. Re-proven independently by begin_external_card_payment rather than trusted, since hiding a button is not authorization (I12).';

revoke all on function app.external_card_payment_availability(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION "public"."external_card_payment_availability"("p_invoice_id" "uuid", "p_provider" "text") RETURNS TABLE("outstanding_minor" bigint, "currency" "text", "account_id" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare org uuid;
begin
 select organization_id into org from public.portal_context();
 if org is null or not app.portal_exposed(org,'invoices',true) or not app.module_enabled(org,'card_payments') or not app.module_entitled(org,'card_payments') then return; end if;
 return query select * from app.external_card_payment_availability(p_invoice_id,p_provider);
end $$;

comment on function public.external_card_payment_availability(uuid, text) is null;

CREATE OR REPLACE FUNCTION "public"."begin_external_card_payment"("p_invoice_id" "uuid", "p_provider" "text") RETURNS TABLE("request_id" "uuid", "outstanding_minor" bigint, "currency" "text", "account_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare org uuid;
begin
 select organization_id into org from public.portal_context();
 if org is null or not app.portal_exposed(org,'invoices',true) or not app.module_enabled(org,'card_payments') or not app.module_entitled(org,'card_payments') then raise exception 'Payments are not available in this Portal' using errcode='42501'; end if;
 return query select * from app.begin_external_card_payment(p_invoice_id,p_provider);
end $$;

revoke all on function public.external_card_payment_availability(uuid, text), public.begin_external_card_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.external_card_payment_availability(uuid, text), public.begin_external_card_payment(uuid, text) to authenticated;

-- Portal text validation trims a real vertical tab (\013); `\v` is not an escape in PostgreSQL.
CREATE OR REPLACE FUNCTION "app"."portal_text"("v" "jsonb", "n" integer, "empty_ok" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
 select jsonb_typeof(v)='string' and length(v #>> '{}')<=n and (empty_ok or length(btrim(v #>> '{}',E' \t\n\r\f\013'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0);
$$;

-- Publishing an unchanged draft returns the draft to editing rather than leaving it submitted.
CREATE OR REPLACE FUNCTION "public"."publish_portal_draft"("p_organization_id" "uuid", "p_expected_version" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare p public.portal_definitions; v_id uuid; live jsonb;
begin
 if auth.uid() is null or not app.has_capability(p_organization_id,'organization.manage') then raise exception 'Organization management required' using errcode='42501'; end if;
 select * into p from public.portal_definitions where organization_id=p_organization_id for update;
 if not found or p_expected_version is distinct from p.draft_version then raise exception 'Portal changed. Reload before publishing.' using errcode='PT409'; end if;
 if not app.module_enabled(p_organization_id,'portal') or not app.portal_feature_available(p_organization_id,'portal_auth') then raise exception 'Portal entitlement and activation required' using errcode='42501'; end if;
 select app.upgrade_portal_content(content) into live from public.portal_revisions where organization_id=p_organization_id and portal_revisions.id=p.published_revision_id;
 if live=p.draft_content then
  update public.portal_definitions set draft_status='draft',submitted_at=null,submitted_by=null where organization_id=p_organization_id;
  return p.published_revision_id;
 end if;
 if p.draft_status<>'in_review' then raise exception 'Send this saved draft for review before publishing' using errcode='22023'; end if;
 v_id:=app.publish_portal_draft(p_organization_id,p_expected_version);
 update public.portal_revisions set reviewed_at=p.submitted_at,reviewed_by=p.submitted_by where organization_id=p_organization_id and portal_revisions.id=v_id;
 update public.portal_definitions set draft_status='draft',submitted_at=null,submitted_by=null where organization_id=p_organization_id;
 return v_id;
end $$;

-- Reached only through consume_public_communication_rate_limit (security definer), never directly.
alter table public.public_communication_rate_limits force row level security;
REVOKE ALL PRIVILEGES
ON TABLE public.public_communication_rate_limits
FROM PUBLIC, anon, authenticated;

notify pgrst, 'reload schema';
