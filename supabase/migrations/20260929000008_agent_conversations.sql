-- A conversation is what a run belongs to, so questions asked in a row can be read as one thread.
--
-- Until now `agent_runs` was a flat list of independent questions, and the screen drew them as a
-- thread that the answering side never saw. This gives them an identity to belong to, and keeps
-- everything D34 decided about who may read one: an answer holds whatever its asker could see, so
-- a conversation is readable by the person who started it and by nobody else in the business.

-- ---------------------------------------------------------------------------
-- agent_conversations
-- ---------------------------------------------------------------------------

create table public.agent_conversations (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  created_by       uuid        not null references auth.users (id),

  -- The first question, shortened. Derived by the domain layer rather than asked of a model: a
  -- second provider call to name a thread would be spending money to label what somebody just typed.
  title            text        not null check (length(btrim(title)) between 1 and 120),

  created_at       timestamptz not null default now(),

  -- What History sorts by. Written only by `agent_runs`' insert trigger below, so it cannot drift
  -- from the runs it summarizes and no caller holds a grant to set it.
  last_activity_at timestamptz not null default now(),

  -- The target of `agent_runs`' composite key. Carrying `created_by` in it is what makes a run
  -- filed under somebody else's conversation impossible at the table rather than a thing a policy
  -- has to remember to check.
  constraint agent_conversations_scope_key unique (organization_id, created_by, id)
);

comment on table public.agent_conversations is
  'A thread of Agent questions by one person in one business. Readable only by whoever started it -- see D34.';

-- The one query History makes: mine, in this business, most recently active first.
create index agent_conversations_org_asker_activity_idx
  on public.agent_conversations (organization_id, created_by, last_activity_at desc);

-- ---------------------------------------------------------------------------
-- agent_runs.conversation_id
-- ---------------------------------------------------------------------------

alter table public.agent_runs add column conversation_id uuid;

-- The runs that exist were asked one at a time and were never turns of a known conversation, so
-- each becomes a conversation of its own rather than being welded into one invented thread. The
-- run's own id is reused as its conversation's id: it is already unique, it needs no mapping
-- table, and it is only an identifier. The question, answer and tool facts are not touched; only
-- the new column is filled in.
--
-- backfill:begin
insert into public.agent_conversations (id, organization_id, created_by, title, created_at, last_activity_at)
select r.id,
       r.organization_id,
       r.created_by,
       -- The same rule `deriveConversationTitle` applies: whitespace collapsed, 60 characters at most.
       case when length(q.text) > 60 then left(q.text, 59) || '…' else q.text end,
       r.occurred_at,
       r.occurred_at
  from public.agent_runs r
 cross join lateral (select btrim(regexp_replace(r.question, '\s+', ' ', 'g')) as text) q
 where r.conversation_id is null;

update public.agent_runs
   set conversation_id = id
 where conversation_id is null;
-- backfill:end

alter table public.agent_runs alter column conversation_id set not null;

alter table public.agent_runs
  add constraint agent_runs_conversation_fkey
  foreign key (organization_id, created_by, conversation_id)
  references public.agent_conversations (organization_id, created_by, id)
  on delete cascade;

-- A transcript, oldest to newest, for one conversation.
create index agent_runs_org_conversation_idx
  on public.agent_runs (organization_id, conversation_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- last_activity_at
-- ---------------------------------------------------------------------------

-- `security definer` because the caller holds no update grant on `agent_conversations` at all, and
-- giving them one to set a timestamp would be a promise about every column the table will ever
-- have. The function touches exactly one row, the one the inserted run belongs to.
create function app.touch_agent_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.agent_conversations
     set last_activity_at = greatest(last_activity_at, new.occurred_at)
   where organization_id = new.organization_id
     and id = new.conversation_id;
  return new;
end;
$fn$;

revoke all on function app.touch_agent_conversation() from public;

create trigger agent_runs_touch_conversation
  after insert on public.agent_runs
  for each row execute function app.touch_agent_conversation();

-- ---------------------------------------------------------------------------
-- RLS (I1, I2)
-- ---------------------------------------------------------------------------

alter table public.agent_conversations enable row level security;
alter table public.agent_conversations force row level security;

-- The reasoning is `agent_runs_select`'s, restated: membership is not enough, because a thread
-- holds what its asker was allowed to read and a colleague may have been allowed less.
create policy agent_conversations_select on public.agent_conversations
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
  );

create policy agent_conversations_insert on public.agent_conversations
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'assistant.ask')
  );

-- No update policy and no delete, for the reason `agent_runs` has none: what was asked is not
-- editable afterwards, and the title is a snapshot of the first question.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.agent_conversations to authenticated;
grant insert (organization_id, created_by, title) on public.agent_conversations to authenticated;

grant insert (conversation_id) on public.agent_runs to authenticated;
