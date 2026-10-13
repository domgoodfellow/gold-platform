-- Reconcile the pre-existing library job reference with the canonical tenant-key invariant.
alter table public.integration_library_jobs drop constraint integration_library_jobs_execution_id_fkey;
alter table public.integration_library_jobs drop constraint integration_library_jobs_execution_id_key;
alter table public.integration_library_jobs
  add constraint integration_library_jobs_execution_same_org
    foreign key(organization_id,execution_id) references public.integration_executions(organization_id,id) on delete cascade,
  add constraint integration_library_jobs_org_execution_unique unique(organization_id,execution_id);
create index integration_library_jobs_execution_lookup on public.integration_library_jobs(execution_id);
