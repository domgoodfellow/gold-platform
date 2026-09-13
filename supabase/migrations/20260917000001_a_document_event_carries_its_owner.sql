-- A document's own event names the document; nothing ever said whose it was.
--
-- **The defect.** `create_document` (20260827000005) already receives the customer, location,
-- asset or work item id a document is attached to — the composite-FK columns on `documents`
-- exist for exactly that reason (I18) — but the event it writes carries none of it:
--
--   entity_type = 'document', entity_id = <the document's own id>,
--   payload = {file_name, size_bytes}
--
-- A timeline answering "what happened to this customer" or "what happened to this job" has no
-- way back from that row to the record it was attached to. `customer.created`, `location.linked`
-- and every `work_item.*` event names its subject directly or, for `location.linked`, carries the
-- owning id in its payload; `document.created` did neither. `CUSTOMER_ACTIONS` (timeline.ts) has
-- listed it and `describe()` has had a sentence for it since M4-era work, and neither has ever
-- fired — a customer's own document uploads have been silently invisible in their own history.
--
-- **The fix follows the precedent already in this codebase**, not a new one: `location.linked`
-- is written against the location (its own subject) and carries `customer_id` in its payload so
-- `customer_activity` can attribute it to a customer despite that. `document.created` gets the
-- same treatment — still written against the document, now carrying whichever of `customer_id`,
-- `location_id`, `asset_id`, `work_item_id` the upload named, stripped of the three that are
-- null so old and new payloads read the same shape `location.linked` already established. No
-- entity_type changes, no new polymorphic relationship, no second activity store: the owning id
-- travels exactly the way the one other cross-entity event already carries it.
--
-- **`customer_activity` gains two branches**, not a rewrite: one for a document attached
-- directly to a customer, one for a document attached to a job (resolved to that job's customer,
-- same as every other work-item-shaped event the view already attributes). A document attached
-- to a location or an asset is not a business's customer-shaped history and correctly does not
-- appear there — it is exactly the shape `listWorkItemTimeline` and a future asset/location
-- timeline would read directly off `events`, once one exists.
--
-- **Old rows are backfilled**, not left dark. The join key is exact (`events.entity_id =
-- documents.id` for `action = 'document.created'`) and nothing about actor or time is touched —
-- only the payload gains the attribution the row always had a right to, read back from the
-- `documents` row that has carried it, unmodified, since the event was written. A forward-only
-- fix would have meant every document uploaded before today stays invisible in its own record's
-- history forever, for a fact that was never actually missing, only never copied.

-- ---------------------------------------------------------------------------
-- Backfill: give every existing document.created event the attribution it always had
-- ---------------------------------------------------------------------------

update public.events e
   set payload = e.payload || jsonb_strip_nulls(jsonb_build_object(
         'customer_id',   d.customer_id,
         'location_id',   d.location_id,
         'asset_id',      d.asset_id,
         'work_item_id',  d.work_item_id
       ))
  from public.documents d
 where e.action = 'document.created'
   and e.entity_type = 'document'
   and e.entity_id = d.id;

-- ---------------------------------------------------------------------------
-- New uploads carry their attribution from the start
-- ---------------------------------------------------------------------------

create or replace function public.create_document(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_location_id     uuid,
  p_asset_id        uuid,
  p_work_item_id    uuid,
  p_storage_path    text,
  p_file_name       text,
  p_mime_type       text,
  p_size_bytes      bigint
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_document requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.documents
    (organization_id, customer_id, location_id, asset_id, work_item_id,
     storage_path, file_name, mime_type, size_bytes, created_by)
  values
    (p_organization_id, p_customer_id, p_location_id, p_asset_id, p_work_item_id,
     p_storage_path, p_file_name, p_mime_type, p_size_bytes, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'document', v_id, 'document.created',
     jsonb_strip_nulls(jsonb_build_object(
       'file_name', p_file_name,
       'size_bytes', p_size_bytes,
       'customer_id', p_customer_id,
       'location_id', p_location_id,
       'asset_id', p_asset_id,
       'work_item_id', p_work_item_id
     )));

  return v_id;
end;
$fn$;

comment on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) is
  'Stores a document and its creation event in one transaction. The event payload carries whichever owning id (customer/location/asset/work item) the upload named, null-stripped, so a timeline can attribute it without a polymorphic relationship.';

-- Ownership unchanged by the CREATE OR REPLACE above; restated because a prior migration's
-- revoke/grant does not survive a function being dropped and recreated under some Postgres
-- versions, and does under others — explicit here removes the ambiguity either way.
revoke all on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) from public;
grant execute on function public.create_document(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- customer_activity: a document is the customer's history too, directly or via their job
-- ---------------------------------------------------------------------------

create or replace view public.customer_activity
with (security_invoker = true) as
  select e.organization_id,
         coalesce(
           -- Written against the customer.
           c.id,
           -- Written against one of their jobs, which is most of what a business remembers.
           w.customer_id,
           case
             -- Written against the location and naming them in the payload.
             when e.action = 'location.linked' and e.payload ? 'customer_id'
               then (e.payload ->> 'customer_id')::uuid
             -- Written against the document and naming them directly.
             when e.action = 'document.created' and e.payload ? 'customer_id'
               then (e.payload ->> 'customer_id')::uuid
             -- Written against the document and naming one of their jobs instead — resolved
             -- the same way `w.customer_id` resolves a direct work-item event, because a
             -- document attached to a job is exactly as much this customer's history as any
             -- other thing that happened on that job.
             when e.action = 'document.created' and e.payload ? 'work_item_id' then (
               select wi.customer_id
                 from public.work_items wi
                where wi.organization_id = e.organization_id
                  and wi.id = (e.payload ->> 'work_item_id')::uuid
             )
           end
         ) as customer_id,
         e.id as event_id,
         e.action,
         e.entity_type,
         e.entity_id,
         e.payload,
         e.actor_id,
         e.occurred_at
    from public.events e
    left join public.customers c
      on c.organization_id = e.organization_id
     and c.id = e.entity_id
    left join public.work_items w
      on w.organization_id = e.organization_id
     and w.id = e.entity_id;

comment on view public.customer_activity is
  'Every event that is about a customer, including the ones written against their jobs, the ones naming them only in a location or document payload, and a document written against one of their jobs. security_invoker: RLS on the tables underneath is what scopes it.';

grant select on public.customer_activity to authenticated;
