-- A proposed configuration, drafted from prose, reviewed by a person, applied by that person.
--
-- The row M8's second criterion turns on, and `constraints.md` D32 holds the reasoning. What
-- this file is responsible for is the half of D32 the database can enforce.
--
-- **Nothing here is written by a model.** The drafting call happens in `apps/web`, returns a
-- shape and a list of gaps, and the *person* who asked for it owns the insert -- `created_by`
-- is them, the capability check is against their role, and RLS scopes it to their tenant like
-- any other row. There is no actor with no person behind it on this axis, which is what makes
-- it different from `automation_runs` and from the payment webhook: an automation acts when
-- nobody is present, and a proposal is something somebody asked for while sitting there.
--
-- **The proposal holds no foreign key to what applying it produced, and none may be added.**
-- The same absence `work_item_priced_lines` keeps against `price_book_items` and
-- `automation_runs` keeps against its rule, for the same reason (I8): `result` snapshots the
-- ids and the words as they were at the moment somebody approved them, and a key is how
-- somebody eventually writes the join that makes last month's record report this month's
-- configuration. A proposal is a record of a decision, not a live view of its consequences.
--
-- **A failed apply is a row, not a rollback** (D32). `configureBusiness` is deliberately not
-- atomic and stays so, because atomicity here means one privileged function taking the shape as
-- JSON -- which puts the order of those steps in the database and makes a second configuration
-- path. D29 forbids a second *creation* path more strongly than it forbids anything else, and
-- this is the same mistake one level down. So a failure carries the database's own words in
-- `detail` and whatever landed in `result`, which is `automation_runs`' shape reused (I25), and
-- the person edits the remainder and applies again.

-- ---------------------------------------------------------------------------
-- The capability
-- ---------------------------------------------------------------------------

-- Asking the platform to draft a configuration is its own authority for the reason
-- `automation.manage` is: it is a decision about how this business is set up, taken by somebody
-- who may not be the person who set it up. Reading a proposal needs no capability -- somebody
-- who cannot ask for one still has to be able to see what was proposed and what happened when
-- it was applied, and hiding that would make the configuration look like it changed by itself.
--
-- **Applying deliberately gets no capability of its own.** Apply is a sequence of ordinary
-- domain calls, and every one of them already runs against a policy calling
-- `app.has_capability` -- so a member who may not create a role cannot apply a proposal that
-- contains one, and the refusal comes from `roles_insert` rather than from anything in the
-- flow. A second check here would be a copy of an authorization rule that already exists, in a
-- place that would go stale the first time the first one changed.
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
    'configuration.propose'
  ]::text[]);

-- Backfilled onto whoever already decides how this business is set up, which is the same
-- answer `automation.manage` gave and for the same reason: a founder holds
-- `organization.manage`, and a business that has been running for a month should not have to
-- go and find a checkbox before it can ask for help with the rest of its setup.
update public.roles
   set capabilities = capabilities || array['configuration.propose']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('configuration.propose' = any (capabilities));

-- ---------------------------------------------------------------------------
-- configuration_proposals
-- ---------------------------------------------------------------------------

create table public.configuration_proposals (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- What the person wrote. Kept because a proposal that cannot show what it was drafted from
  -- cannot be judged -- the reviewer's first question is always whether the platform understood
  -- them, and that is unanswerable from the shape alone.
  description     text        not null check (length(btrim(description)) between 1 and 8000),

  -- The proposed `BusinessShape`, exactly as `configureBusiness` will be handed it.
  --
  -- **jsonb rather than a table per part**, which is the one place this schema stores structure
  -- it could have normalised. The reason is that a proposal is not configuration: it is a
  -- document somebody is arguing with, and the tables it *becomes* already exist. Normalising
  -- it would mean a second, shadow copy of `work_item_statuses`, `price_book_items` and the
  -- rest -- rows that look like configuration, are not, and would eventually be read by
  -- something that could not tell.
  shape           jsonb       not null,

  -- What the drafting could not infer, as questions a person can answer. The "guide and fill in
  -- the blanks" half: the screen turns each of these into a box, and answering produces the
  -- next turn. Empty is an ordinary answer and means nothing was thin.
  gaps            jsonb       not null default '[]'::jsonb,

  -- Platform vocabulary, and legitimately so: this describes what happened to a platform
  -- artefact. A tenant owns the statuses of its *work* -- what a proposal can be is not a thing
  -- a business has an opinion about, any more than `automation_runs.outcome` is.
  outcome         text        not null default 'draft'
    check (outcome in ('draft', 'applied', 'failed', 'discarded')),

  -- The database's or the domain layer's own words when an apply did not finish. Never the
  -- platform's paraphrase of them (I25's reasoning: a failure a person cannot act on is a
  -- failure recorded for nobody).
  detail          text,

  -- What applying produced, snapshotted -- the ids `configureBusiness` returned, and nothing
  -- joined. On a failure this holds whatever landed before it stopped, which is what makes
  -- "edit the remainder" possible rather than a guess.
  result          jsonb,

  -- Which provider drafted it, for somebody reading the row a year later. It decides nothing
  -- and no code branches on it -- the same role `ProviderPayment` gives the payments adapter.
  drafted_by      text        not null check (length(btrim(drafted_by)) between 1 and 80),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  applied_at      timestamptz,

  -- I25's shape: a failure must carry words, and anything else must not invent them.
  constraint configuration_proposals_detail_matches_outcome
    check ((outcome = 'failed') = (detail is not null)),

  -- An outcome that ended in a write has an instant; a draft and a discarded one do not.
  constraint configuration_proposals_applied_at_matches_outcome
    check ((outcome in ('applied', 'failed')) = (applied_at is not null))
);

comment on table public.configuration_proposals is
  'A configuration drafted from a business''s own description, for a person to review, edit and apply. Holds no foreign key to what applying it produced -- see D32.';

-- The only query this table has: the newest proposals for one business. `desc` because every
-- caller wants the current one and none has ever wanted the first.
create index configuration_proposals_org_created_idx
  on public.configuration_proposals (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS (I1, I2)
-- ---------------------------------------------------------------------------

alter table public.configuration_proposals enable row level security;
alter table public.configuration_proposals force row level security;

-- Reading needs membership and no capability -- see the capability note above.
create policy configuration_proposals_select on public.configuration_proposals
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy configuration_proposals_insert on public.configuration_proposals
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'configuration.propose')
  );

-- **Only a draft is editable, and that is what makes the record honest.** The review screen is
-- editable by design (D32) -- a review a person cannot change is a rubber stamp -- so the shape
-- must be writable while somebody is arguing with it. The moment it has been applied, failed or
-- discarded, this policy stops matching and the row is frozen: what was applied cannot be
-- rewritten afterwards to say something else was.
--
-- Re-applying after a failure is therefore a *new* draft carrying the remainder, not an edit to
-- the failed one. The failed row stays as the record of what went wrong.
create policy configuration_proposals_update on public.configuration_proposals
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and outcome = 'draft'
    and app.has_capability(organization_id, 'configuration.propose')
  )
  with check (organization_id in (select app.current_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- **No delete, on purpose.** Discarding is an outcome rather than a disappearance: a business
-- that asked for a proposal and rejected it has made a decision, and the next person to wonder
-- why the setup looks the way it does is owed the ones that were turned down.
grant select, insert on public.configuration_proposals to authenticated;

-- Not `organization_id`, not `created_by`, not `created_at`, not `drafted_by`. Moving a proposal
-- between businesses, reassigning who asked for it, or changing which provider drafted it are
-- each a way of making the record say something that did not happen -- the same reasoning that
-- refuses a field definition's `kind` and `key`.
revoke update on public.configuration_proposals from authenticated;
grant update (description, shape, gaps, outcome, detail, result, applied_at)
  on public.configuration_proposals to authenticated;

-- **`outcome` is writable by the person, and this table is the right place for that**, which is
-- worth saying because `automation_runs` refuses it. That table records what the *platform* did
-- with nobody present, so a user who could edit it could rewrite history they were not part of.
-- This one records what a *person* did in their own tenant, holding the capability to do it.
-- The row is their account of their own act, and freezing it after the fact (above) is the
-- guarantee that matters.
