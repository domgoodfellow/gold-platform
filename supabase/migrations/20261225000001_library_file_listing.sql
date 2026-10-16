-- The Library's file list and its summary. (Conversation 13, slice 13.3.)
--
-- Usage is a question about links, so filtering "not used by any record" in the database is the only
-- way the count and the page agree. Both functions are security invoker: the documents policies decide
-- what a member sees, and an Agent-private file is excluded here explicitly because it is never a
-- Library file, even for its owner.

create function public.library_file_page(
  p_organization_id uuid,
  p_search          text default null,
  p_mime_types      text[] default null,
  p_usage           text default 'any',
  p_sort            text default 'newest',
  p_limit           integer default 25,
  p_offset          integer default 0
)
returns table (
  id              uuid,
  file_name       text,
  mime_type       text,
  size_bytes      bigint,
  created_at      timestamptz,
  content_sha256  text,
  link_count      bigint,
  total_count     bigint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with listed as (
    select d.id, d.file_name, d.mime_type, d.size_bytes, d.created_at, d.content_sha256,
           (select count(*) from public.document_links l
             where l.organization_id = d.organization_id and l.document_id = d.id) as link_count
      from public.documents d
     where d.organization_id = p_organization_id
       and d.agent_user_id is null
       and (p_search is null or p_search = '' or strpos(lower(d.file_name), lower(p_search)) > 0)
       and (p_mime_types is null or d.mime_type = any (p_mime_types))
  )
  select l.id, l.file_name, l.mime_type, l.size_bytes, l.created_at, l.content_sha256, l.link_count,
         count(*) over () as total_count
    from listed l
   where case p_usage
           when 'unused' then l.link_count = 0
           when 'linked' then l.link_count > 0
           else true
         end
   order by
     case when p_sort = 'oldest' then l.created_at end asc,
     case when p_sort = 'name' then lower(l.file_name) end asc,
     case when p_sort = 'largest' then l.size_bytes end desc,
     l.created_at desc,
     l.id
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$fn$;

comment on function public.library_file_page(uuid, text, text[], text, text, integer, integer) is
  'One page of Library files, filtered and sorted in the database. total_count is the number of files matching the filters before paging. Agent-private files are never listed.';

create function public.library_file_summary(p_organization_id uuid)
returns table (
  file_count   bigint,
  total_bytes  bigint,
  unused_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select count(*),
         coalesce(sum(d.size_bytes), 0)::bigint,
         count(*) filter (
           where not exists (
             select 1 from public.document_links l
              where l.organization_id = d.organization_id and l.document_id = d.id
           )
         )
    from public.documents d
   where d.organization_id = p_organization_id
     and d.agent_user_id is null;
$fn$;

revoke all on function public.library_file_page(uuid, text, text[], text, text, integer, integer) from public;
revoke all on function public.library_file_summary(uuid) from public;
grant execute on function public.library_file_page(uuid, text, text[], text, text, integer, integer) to authenticated;
grant execute on function public.library_file_summary(uuid) to authenticated;
