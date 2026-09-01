-- Telling somebody, in the business's own words, once.
--
-- **The platform writes none of this.** `constraints.md` forbids hardcoding a claim a business
-- makes about itself, and a message to that business's customer is exactly such a claim -- more
-- so than a public page, because it arrives with the business's name on it in somebody's inbox.
-- So a template is rows a business wrote, the resolver below substitutes values and adds not one
-- word, and the delivery carries the finished text. There is no preamble, no signature and no
-- footer anywhere in this file.
--
-- **Once per recipient per reason, and the index is what makes that true.** The failure it
-- prevents is telling a customer the same thing twice, which is the failure a business notices
-- and a developer does not. A check before the insert would race identically -- the same
-- reasoning I6 and I7 already carry.
--
-- **Queued here, sent elsewhere.** Writing the row is a database transaction inside whatever
-- write tripped the rule; sending is an HTTPS call to somebody else, and putting one inside the
-- other would mean a customer's booking waiting on a mail provider and failing when it is down.
-- `apps/api` drains this queue (D2, D30).

-- ---------------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------------

create table public.message_templates (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- What this business calls the template, for its own list. Never sent anywhere.
  name            text        not null check (length(btrim(name)) between 1 and 120),

  -- A subject line for email. Empty for a text message, which has none -- checked against the
  -- channel at the moment an action names both, rather than here, because a template can be
  -- used by more than one action.
  subject         text        not null default '' check (length(subject) <= 300),

  -- **Every word a customer reads.** Placeholders are `{{job}}`, `{{business}}`, `{{customer}}`,
  -- `{{status}}` and `{{when}}`; anything else is left exactly as typed rather than blanked,
  -- because a business writing about a `{{price}}` we do not offer should see its own text come
  -- back, not a hole.
  body            text        not null check (length(btrim(body)) between 1 and 4000),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.message_templates is
  'What a business says to its customers. The platform substitutes values into it and writes nothing of its own.';

create unique index message_templates_org_name_unique
  on public.message_templates (organization_id, lower(name));

alter table public.message_templates
  add constraint message_templates_org_id_unique unique (organization_id, id);

-- ---------------------------------------------------------------------------
-- The notify action
-- ---------------------------------------------------------------------------

alter table public.automation_actions
  add column template_id uuid,
  -- Which way to reach them. A business that has an address and no phone writes an email rule.
  add column channel     text check (channel in ('email', 'sms'));

alter table public.automation_actions
  add constraint automation_actions_template_same_org
  foreign key (organization_id, template_id)
  references public.message_templates (organization_id, id);

alter table public.automation_actions drop constraint automation_actions_status_matches_kind;

alter table public.automation_actions
  drop constraint if exists automation_actions_action_kind_check;

alter table public.automation_actions
  add constraint automation_actions_action_kind_check
  check (action_kind in ('change_status', 'notify'));

-- Each kind carries exactly what it needs and nothing else, in the shape
-- `work_item_types_bookable_is_complete` established: the columns are the answer, and there is
-- no flag beside them to contradict it.
alter table public.automation_actions
  add constraint automation_actions_config_matches_kind
  check (
    (action_kind = 'change_status'
       and status_id is not null and template_id is null and channel is null)
    or (action_kind = 'notify'
       and status_id is null and template_id is not null and channel is not null)
  );

-- ---------------------------------------------------------------------------
-- message_deliveries
-- ---------------------------------------------------------------------------

create table public.message_deliveries (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- **No foreign key to the rule or to the template**, and none may be added. Both are the same
  -- absence `automation_runs` and `work_item_priced_lines` keep (I8): what was sent is a fact
  -- about a moment, and a key is how somebody eventually writes the join that makes last
  -- month's message report this month's wording.
  rule_id         uuid        not null,
  rule_name       text        not null,

  subject_type    text        not null,
  subject_id      uuid        not null,

  channel         text        not null check (channel in ('email', 'sms')),

  -- Where it went, exactly as it was at the moment it was queued. A customer who changes their
  -- address does not change where yesterday's message was sent.
  recipient       text        not null check (length(btrim(recipient)) between 1 and 320),

  -- The finished words. Resolved from the template once, here, and never resolved again --
  -- editing a template tomorrow cannot rewrite what somebody has already read.
  subject_line    text        not null default '',
  body            text        not null check (length(btrim(body)) > 0),

  state           text        not null default 'queued'
                              check (state in ('queued', 'sent', 'failed')),

  -- Why it failed, in the provider's own words. Null while queued and after it is sent.
  detail          text,

  queued_at       timestamptz not null default now(),
  sent_at         timestamptz,

  constraint message_deliveries_sent_at_matches_state
    check ((state = 'sent') = (sent_at is not null)),

  constraint message_deliveries_detail_matches_state
    check ((state = 'failed') = (detail is not null))
);

comment on table public.message_deliveries is
  'One message, queued by a rule and sent by apps/api. Unique per rule, subject and recipient, so nobody is told the same thing twice.';

-- **The whole of "once".** I2 leads it with the tenant, and the rest is the reason: this rule,
-- about this job, to this person. A second rule may write to the same person about the same job
-- -- two different things to say -- and the same rule may write to them about a different job.
create unique index message_deliveries_once_per_reason
  on public.message_deliveries (organization_id, rule_id, subject_type, subject_id, recipient);

-- The sender's own query: what is waiting, oldest first.
create index message_deliveries_queued_idx
  on public.message_deliveries (organization_id, queued_at)
  where state = 'queued';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.message_templates  enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.message_templates  force row level security;
alter table public.message_deliveries force row level security;

create policy message_templates_select on public.message_templates
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy message_templates_insert on public.message_templates
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'automation.manage')
  );

create policy message_templates_update on public.message_templates
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'automation.manage')
  )
  with check (organization_id in (select app.current_tenant_ids()));

create policy message_templates_delete on public.message_templates
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'automation.manage')
  );

-- Read only, like `automation_runs` and for the same reason: a record of what was sent that its
-- users could edit would be worth nothing. Written by the notify action, marked by the sender.
create policy message_deliveries_select on public.message_deliveries
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

grant select, insert, delete on public.message_templates to authenticated;
grant update (name, subject, body) on public.message_templates to authenticated;
grant select on public.message_deliveries to authenticated;

-- ---------------------------------------------------------------------------
-- Resolving a template
-- ---------------------------------------------------------------------------

-- **Substitution and nothing else.** Every value comes from a row this business owns; the
-- function contributes punctuation to none of it. An unknown placeholder is left exactly as the
-- business typed it, which is the honest answer -- blanking it would silently delete a sentence
-- somebody wrote.
--
-- The instant is rendered in the tenant's own timezone (I9). There is no format here that a
-- business can configure yet, and when one asks, it is a column on the organization rather than
-- a branch in this function.
create function app.resolve_message_template(p_text text, p_item public.work_items)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_out      text := p_text;
  v_org      public.organizations;
  v_status   text;
  v_customer text;
  v_when     text := '';
begin
  select * into v_org from public.organizations where id = p_item.organization_id;

  select s.name into v_status
    from public.work_item_statuses s where s.id = p_item.status_id;

  select c.name into v_customer
    from public.customers c where c.id = p_item.customer_id;

  if p_item.scheduled_during is not null then
    v_when := to_char(
      lower(p_item.scheduled_during) at time zone v_org.timezone,
      'FMDay FMDD FMMonth YYYY, HH24:MI'
    );
  end if;

  v_out := replace(v_out, '{{job}}', coalesce(p_item.title, ''));
  v_out := replace(v_out, '{{business}}', coalesce(v_org.name, ''));
  v_out := replace(v_out, '{{status}}', coalesce(v_status, ''));
  v_out := replace(v_out, '{{customer}}', coalesce(v_customer, ''));
  v_out := replace(v_out, '{{when}}', v_when);

  return v_out;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The action itself
-- ---------------------------------------------------------------------------

-- Replaces `app.run_automation` with a second action kind. The `change_status` half is
-- unchanged; what is new is below it.
create or replace function app.run_automation(
  p_rule_id      uuid,
  p_subject_type text,
  p_subject_id   uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_rule      public.automation_rules;
  v_action    public.automation_actions;
  v_item      public.work_items;
  v_template  public.message_templates;
  v_recipient text;
  v_acted     boolean := false;
begin
  select * into v_rule from public.automation_rules where id = p_rule_id;
  if v_rule.id is null or not v_rule.enabled then
    return false;
  end if;

  if p_subject_type <> 'work_item' then
    return false;
  end if;

  select * into v_item
    from public.work_items
   where id = p_subject_id
     and organization_id = v_rule.organization_id;

  if v_item.id is null then
    return false;
  end if;

  if not app.automation_conditions_hold(v_rule.id, v_item) then
    return false;
  end if;

  perform set_config('app.automation_rule_id', v_rule.id::text, true);

  for v_action in
    select * from public.automation_actions
     where rule_id = v_rule.id
     order by position, created_at
  loop
    if v_action.action_kind = 'change_status' then
      if v_item.status_id is distinct from v_action.status_id then
        update public.work_items
           set status_id = v_action.status_id
         where id = v_item.id;

        insert into public.events
          (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          v_rule.organization_id,
          '00000000-0000-4000-8000-0000000000a2',
          'work_item',
          v_item.id,
          'work_item.status_changed',
          jsonb_build_object(
            'status_id', v_action.status_id,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      end if;

    elsif v_action.action_kind = 'notify' then
      select * into v_template
        from public.message_templates
       where id = v_action.template_id;

      if v_template.id is null then
        raise exception 'the template this rule writes from is no longer here';
      end if;

      -- **Who to write to is the job's customer, and there is deliberately no other option
      -- yet.** A fixed address and a role are both plausible and neither has a caller; adding
      -- them now would be two columns nobody fills in.
      if v_action.channel = 'email' then
        select nullif(btrim(c.email), '') into v_recipient
          from public.customers c where c.id = v_item.customer_id;
      else
        select nullif(btrim(c.phone), '') into v_recipient
          from public.customers c where c.id = v_item.customer_id;
      end if;

      -- Raised rather than skipped, so it lands in `automation_runs` where somebody sees it. A
      -- business that does not want this on every job adds a condition, which is what
      -- conditions are for -- and the sentence says so.
      if v_recipient is null then
        raise exception
          'this job has nobody to write to; add a condition so the rule only runs when it does';
      end if;

      -- The unique index is what makes this happen once. A second attempt is not a failure --
      -- the customer has already been told -- so it is swallowed here rather than raised, and
      -- the run simply does not count it as something that happened.
      begin
        insert into public.message_deliveries
          (organization_id, rule_id, rule_name, subject_type, subject_id, channel, recipient,
           subject_line, body)
        values (
          v_rule.organization_id,
          v_rule.id,
          v_rule.name,
          'work_item',
          v_item.id,
          v_action.channel,
          v_recipient,
          app.resolve_message_template(v_template.subject, v_item),
          app.resolve_message_template(v_template.body, v_item)
        );

        insert into public.events
          (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          v_rule.organization_id,
          '00000000-0000-4000-8000-0000000000a2',
          'work_item',
          v_item.id,
          'work_item.message_queued',
          jsonb_build_object(
            'channel', v_action.channel,
            'automation_rule_id', v_rule.id,
            'automation_rule_name', v_rule.name
          )
        );

        v_acted := true;
      exception when unique_violation then
        null;
      end;
    end if;
  end loop;

  perform set_config('app.automation_rule_id', '', true);

  return v_acted;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Marking one sent
-- ---------------------------------------------------------------------------

-- **The only write the sender holds, and it takes no organization id.** The row already knows
-- which business it belongs to, so a caller cannot name one -- the same shape
-- `record_provider_payment` has, and the reason D26 gives for it: the caller supplies what
-- happened, never where it lands.
create function public.record_message_delivery(
  p_id     uuid,
  p_sent   boolean,
  p_detail text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  update public.message_deliveries
     set state   = case when p_sent then 'sent' else 'failed' end,
         sent_at = case when p_sent then now() else null end,
         detail  = case when p_sent then null else coalesce(nullif(btrim(p_detail), ''), 'the provider did not say why') end
   where id = p_id
     and state = 'queued';
end;
$fn$;

revoke all on function public.record_message_delivery(uuid, boolean, text) from public;
