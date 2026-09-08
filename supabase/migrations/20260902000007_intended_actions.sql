-- An answer that comes back with something to do about it, which a person decides on.
--
-- D2's contract, D32's flow and D34's last paragraph are all one sentence here: **the loop
-- proposes and the domain layer executes**. What the model produces is a name and some
-- arguments; what happens next is `apps/web` mapping that name through a whitelist to a domain
-- function and calling it *when a person presses the button*, under that person's own session.
-- So every capability check is the ordinary one and a refusal comes from the policy that would
-- have refused a typed-in write.
--
-- **On the run rather than in a table of its own**, because an intended action is the outcome of
-- a question rather than a thing with a life of its own. One question produces at most one, and
-- a second table with the same lifecycle, the same owner and the same freezing rule would be a
-- copy of this one.
--
-- **Nothing here executes anything.** There is no function in this migration and no trigger: the
-- write it leads to is `scheduleWorkItem`, which already exists, is already gated, and is already
-- the only thing that puts a job in the diary. A `security definer` function that performed the
-- action would be the second path to a write that D29's reasoning forbids one level up.

alter table public.agent_runs
  -- The name and the arguments, exactly as the loop reported them. Never trusted: `apps/web`
  -- looks the name up in its own whitelist and validates the arguments with the same schema the
  -- screen's form uses, so a name nothing matches is a recorded refusal rather than a dispatch.
  add column proposed_action jsonb
    check (proposed_action is null or jsonb_typeof(proposed_action) = 'object'),

  -- Platform vocabulary again, and four words rather than three because *nobody has decided yet*
  -- is a real state that a person is looking at.
  --
  --   * `pending`  -- proposed, and waiting for somebody.
  --   * `done`     -- they pressed the button and the domain layer wrote it.
  --   * `declined` -- they read it and said no. Kept, because a proposal that was turned down is
  --                   a decision, and the next person to wonder why the job did not move is owed
  --                   it. The same reasoning `configuration_proposals` has for holding no delete.
  --   * `failed`   -- they pressed the button and the write was refused. The database's own
  --                   words go in `action_detail` (I25).
  add column action_outcome text
    check (action_outcome in ('pending', 'done', 'declined', 'failed')),

  add column action_detail text,
  add column action_taken_at timestamptz,

  -- An action exists or it does not, and its outcome exists exactly when it does.
  add constraint agent_runs_action_outcome_matches_action
    check ((proposed_action is null) = (action_outcome is null)),

  add constraint agent_runs_action_detail_matches_outcome
    check ((action_outcome = 'failed') = (action_detail is not null)),

  -- Anything but pending has an instant; pending does not.
  add constraint agent_runs_action_taken_at_matches_outcome
    check ((action_outcome in ('done', 'declined', 'failed')) = (action_taken_at is not null));

comment on column public.agent_runs.proposed_action is
  'What the model suggested doing about the answer, if anything. A name and arguments, executed by nobody until a person presses a button and the domain layer performs it under their session. See D34.';

-- What the Ask screen asks for: my questions in this business that are still waiting on me.
create index agent_runs_org_asker_pending_idx
  on public.agent_runs (organization_id, created_by, occurred_at desc)
  where action_outcome = 'pending';

-- ---------------------------------------------------------------------------
-- Deciding on one
-- ---------------------------------------------------------------------------

-- **The first update policy this table has, and it is as narrow as the thing it permits.** Only
-- the person who asked, only while the action is still pending, and -- through the column grant
-- below -- only the three columns that record what they decided. The question, the answer and
-- what the tools returned stay frozen, which is the same rule `configuration_proposals` holds
-- once it has been applied: what happened cannot later be rewritten to say something else did.
--
-- Asking again is a new run. There is deliberately no way to put a decided action back to
-- pending, because a proposal acted on twice is a job moved twice.
create policy agent_runs_update on public.agent_runs
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and action_outcome = 'pending'
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and action_outcome in ('done', 'declined', 'failed')
  );

-- The insert grant is by column and this table now has a column it did not have; a table-wide
-- grant would have picked it up silently, which is the failure named twice in CLAUDE.md.
grant insert (proposed_action, action_outcome) on public.agent_runs to authenticated;

-- Not the question, not the answer, not the tools, not `answered_by`, not `created_by`. Those
-- describe what happened and are not anybody's to revise.
grant update (action_outcome, action_detail, action_taken_at) on public.agent_runs to authenticated;
