-- What was asked, what was answered, and which tools were called on the way.
--
-- `automation_runs`' shape on a third axis (I25), and the differences from it are the whole of
-- what this file has to get right. An automation acts when nobody is present; a proposal is
-- something somebody asked for while sitting there; a question is the second of those, so this
-- table looks far more like `configuration_proposals` than like the runs it is named after.

-- ---------------------------------------------------------------------------
-- The capability
-- ---------------------------------------------------------------------------

-- **Asking costs money and sends rows to whoever this deployment answers with.** That is why it
-- is a capability rather than something every member holds: not because a question is dangerous
-- -- a tool can read nothing its caller could not already read -- but because it spends and it
-- discloses, and both are decisions a business takes deliberately.
--
-- **Reading needs no capability, and reading somebody else's is impossible rather than
-- ungranted** -- see the select policy. That is the one place this table departs from every
-- other in the schema, and the reasoning is below.
--
-- **There is no capability for what the tools reach**, and adding one would be a mistake worth
-- naming now. Every tool runs `security invoker` under the caller's own token, so the rows it
-- can see are decided by the same policies their screens obey. A second gate here would be an
-- authorization rule in a place that would go stale the first time the first one changed.
alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
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
    'assistant.ask'
  ]::text[]);

-- The same answer `automation.manage` and `configuration.propose` gave: onto whoever already
-- decides how this business is set up. A business that wants its dispatchers asking questions
-- grants it to them, which is one checkbox and a decision somebody made on purpose.
update public.roles
   set capabilities = capabilities || array['assistant.ask']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('assistant.ask' = any (capabilities));

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  question        text        not null check (length(btrim(question)) between 1 and 2000),

  -- The finished words, snapshotted. Empty for anything but an answered run.
  answer          text        not null default '',

  -- Platform vocabulary, in the way `automation_runs.outcome` is: this describes what the
  -- platform did, which is not a thing a business has an opinion about.
  --
  -- **`unanswered` is not a failure and is recorded apart from one on purpose.** Nothing broke:
  -- the loop ran, the tools answered, and there was nothing to say -- which is a fact about the
  -- question rather than about the system. It is also the only evidence that decides whether
  -- retrieval is worth building, and folding it into either neighbour would destroy that.
  outcome         text        not null check (outcome in ('answered', 'unanswered', 'failed')),

  -- The provider's or the database's own words, never a paraphrase (I25).
  detail          text,

  -- **What was called, with what, and how many rows came back. Never the rows.** A run that
  -- snapshotted what it read would be a second copy of tenant data in a table whose policies are
  -- not the ones protecting the original -- an invoice's own rules, a portal customer's
  -- narrowing, all of it left behind. What was asked survives here; what was read stays where
  -- it lives.
  tools           jsonb       not null default '[]'::jsonb
                              check (jsonb_typeof(tools) = 'array'),

  -- Which model answered, for somebody reading this a year later. It decides nothing and no
  -- code branches on it -- the same standing `configuration_proposals.drafted_by` has. It earns
  -- its place the day a business switches to a model on its own hardware and wants to know
  -- whether that is why the answers changed.
  answered_by     text        not null check (length(btrim(answered_by)) between 1 and 80),

  occurred_at     timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint agent_runs_detail_matches_outcome
    check ((outcome = 'failed') = (detail is not null)),

  -- An answered run has words; nothing else may invent them.
  constraint agent_runs_answer_matches_outcome
    check ((outcome = 'answered') = (length(btrim(answer)) > 0))
);

comment on table public.agent_runs is
  'A question asked of the platform and what came back. Records which tools ran and how many rows each returned, never the rows. Readable only by whoever asked -- see D34.';

-- The only query this table has: my own questions in this business, newest first.
create index agent_runs_org_asker_idx
  on public.agent_runs (organization_id, created_by, occurred_at desc);

-- ---------------------------------------------------------------------------
-- RLS (I1, I2)
-- ---------------------------------------------------------------------------

alter table public.agent_runs enable row level security;
alter table public.agent_runs force row level security;

-- **Readable by the person who asked, and by nobody else in the business.** This is the one
-- deliberate departure from how every other record in this schema is read, and it follows from
-- what the row holds: an answer contains whatever its asker could see. Reading is
-- membership-scoped everywhere in this platform and capability-scoped nowhere -- but the portal
-- narrows a customer to their own jobs and their own invoices, and a run made by an operator can
-- hold rows that narrowing was hiding. A tenant-wide select here would be a way to read, through
-- yesterday's answer, what today's policies refuse.
--
-- `automation_runs` is tenant-wide for the opposite reason: an automation acts when nobody is
-- present, so what it did is everybody's business. Nobody but the asker was present here.
create policy agent_runs_select on public.agent_runs
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
  );

create policy agent_runs_insert on public.agent_runs
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'assistant.ask')
  );

-- No update policy and no delete. A record of what was asked and what was said is not
-- editable afterwards, for the reason a proposal freezes the moment it is applied: the only
-- purpose of changing it would be to make it say something that did not happen.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- By column rather than table-wide. A table-wide insert grant is a promise about every column
-- this table will ever have, and the two times that promise was made here it was broken by a
-- later migration adding a column that inherited it silently.
grant select on public.agent_runs to authenticated;
grant insert (organization_id, question, answer, outcome, detail, tools, answered_by, created_by)
  on public.agent_runs to authenticated;
