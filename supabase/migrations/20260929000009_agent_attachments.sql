-- A file a person attaches to a question for the Agent.
--
-- **Documents own the file; there is no second file universe.** The bytes go in the same private
-- `documents` bucket and the metadata in the same `documents` table, read through the same
-- signed-URL path. What is new is one owner kind and the reading rule that goes with it.
--
-- **The reading rule is the point.** Every other document is readable by the whole business,
-- because a customer's contract is the business's. A file somebody hands the Agent is not: it is
-- part of a question, and a question is readable only by whoever asked (D34). So an Agent file's
-- owner is the *person* (`agent_user_id`), and both the row and its bytes are readable by that
-- person alone. It stays out of every customer, location, asset and work-item document list
-- because it names none of them.
--
-- The owner is a person rather than a conversation because a New chat has no conversation until its
-- first question is sent, and a file is attached before that. The link to the question it was sent
-- with is `agent_run_documents`, written when the run is.

-- ---------------------------------------------------------------------------
-- documents: a fifth owner
-- ---------------------------------------------------------------------------

alter table public.documents
  add column agent_user_id uuid references auth.users (id);

alter table public.documents drop constraint documents_exactly_one_owner;
alter table public.documents
  add constraint documents_exactly_one_owner check (
    (customer_id is not null)::int
    + (location_id is not null)::int
    + (asset_id is not null)::int
    + (work_item_id is not null)::int
    + (agent_user_id is not null)::int
    = 1
  );

-- **What makes an Agent file safe to hand to a model, decided at the table** rather than by
-- whoever wrote the upload. Only text a model can read, small, and only under the asker's own
-- prefix -- so the path *is* the ownership, and a row cannot name somebody else's bytes. The list
-- is the smallest that is actually consumed: nothing here has a text extraction path, so a PDF or
-- an image would be a file the Agent cannot read, and offering one would be a control that does
-- nothing. Widen this only together with the reader that consumes the new type.
alter table public.documents
  add constraint documents_agent_file_is_safe check (
    agent_user_id is null
    or (
      agent_user_id = created_by
      and mime_type in ('text/plain', 'text/csv', 'text/markdown', 'application/json')
      and size_bytes <= 1048576
      and storage_path like organization_id::text || '/agent/' || agent_user_id::text || '/%'
    )
  );

-- The target of `agent_run_documents`' key. Carrying the asker in it is what stops a question
-- from being linked to somebody else's file.
alter table public.documents
  add constraint documents_agent_scope_key unique (organization_id, agent_user_id, id);

-- The same, on the run side.
alter table public.agent_runs
  add constraint agent_runs_scope_key unique (organization_id, created_by, id);

-- ---------------------------------------------------------------------------
-- agent_run_documents: which question a file was sent with
-- ---------------------------------------------------------------------------

create table public.agent_run_documents (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  created_by      uuid        not null references auth.users (id),
  run_id          uuid        not null,
  document_id     uuid        not null,
  created_at      timestamptz not null default now(),

  -- Both halves carry the asker, so a question and the file sent with it always belong to the
  -- same person in the same business.
  constraint agent_run_documents_run_fkey
    foreign key (organization_id, created_by, run_id)
    references public.agent_runs (organization_id, created_by, id) on delete cascade,
  constraint agent_run_documents_document_fkey
    foreign key (organization_id, created_by, document_id)
    references public.documents (organization_id, agent_user_id, id),

  -- A file is sent once. Attaching it again is uploading it again.
  constraint agent_run_documents_document_once unique (organization_id, document_id)
);

comment on table public.agent_run_documents is
  'Which files a question was sent with. Readable only by whoever asked -- see D34.';

create index agent_run_documents_org_run_idx on public.agent_run_documents (organization_id, run_id);

alter table public.agent_run_documents enable row level security;
alter table public.agent_run_documents force row level security;

create policy agent_run_documents_select on public.agent_run_documents
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
  );

create policy agent_run_documents_insert on public.agent_run_documents
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'assistant.ask')
  );

-- No update and no delete: what a question was sent with is not editable afterwards.
grant select on public.agent_run_documents to authenticated;
grant insert (organization_id, created_by, run_id, document_id) on public.agent_run_documents to authenticated;

-- ---------------------------------------------------------------------------
-- documents: who reads and writes an Agent file
-- ---------------------------------------------------------------------------

drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    -- Everyone in the business reads a document; only its owner reads an Agent file.
    and (agent_user_id is null or agent_user_id = (select auth.uid()))
  );

drop policy documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and (
      (agent_user_id is null and app.has_capability(organization_id, 'document.create'))
      -- An Agent file needs the capability to ask, not the one to file documents: it is part of a question.
      or (agent_user_id = (select auth.uid()) and app.has_capability(organization_id, 'assistant.ask'))
    )
  );

-- Removing a file before it is sent. Only an Agent file, only its owner's, and only while no
-- question has been sent with it -- what a question was sent with is not rewritten afterwards.
-- No other document can be deleted by anybody: this is the first delete grant `documents` has.
create policy documents_delete_unsent_agent_file on public.documents
  for delete to authenticated
  using (
    agent_user_id = (select auth.uid())
    and organization_id in (select app.current_tenant_ids())
    and not exists (
      select 1 from public.agent_run_documents l
       where l.organization_id = documents.organization_id and l.document_id = documents.id
    )
  );

-- By column: a table-wide insert grant is a promise about every column this table will ever have.
revoke insert on public.documents from authenticated;
grant insert (
  organization_id, customer_id, location_id, asset_id, work_item_id,
  storage_path, file_name, mime_type, size_bytes, created_by, agent_user_id
) on public.documents to authenticated;
grant delete on public.documents to authenticated;

-- ---------------------------------------------------------------------------
-- The bytes: the same bucket, a private namespace
-- ---------------------------------------------------------------------------

-- `documents` objects are `<organization>/<random>/<name>`. An Agent file is
-- `<organization>/agent/<person>/<random>/<name>`, and the second segment is what tells them
-- apart -- a random uuid can never be the word `agent`. Inside that namespace the third segment
-- must be the caller, so neither listing nor signing nor writing reaches another member's files,
-- whatever the business-wide policies say about the rest of the prefix.
drop policy documents_objects_select on storage.objects;
create policy documents_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
    and (
      (storage.foldername(name))[2] is distinct from 'agent'
      or (storage.foldername(name))[3] = (select auth.uid())::text
    )
  );

drop policy documents_objects_insert on storage.objects;
create policy documents_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
    and (
      (storage.foldername(name))[2] is distinct from 'agent'
      or (
        (storage.foldername(name))[3] = (select auth.uid())::text
        -- Asking is what makes attaching legitimate, in the business the path names.
        and exists (
          select 1 from app.current_tenant_ids() t
           where t::text = (storage.foldername(name))[1]
             and app.has_capability(t, 'assistant.ask')
        )
      )
    )
  );

drop policy documents_objects_delete on storage.objects;
create policy documents_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select t::text from app.current_tenant_ids() t)
    and (
      (storage.foldername(name))[2] is distinct from 'agent'
      or (storage.foldername(name))[3] = (select auth.uid())::text
    )
  );
