-- A read projection only. Channel records and their guarded write commands keep their owners.
create view public.conversation_feed with (security_invoker = true) as
select c.organization_id, c.id, 'message'::text as source, c.channel,
       coalesce(contact.name, c.external_email, c.external_number, '') as title,
       coalesce(c.external_email, c.external_number, '') as external_address,
       c.subject, c.last_message_preview as preview, c.last_message_at as last_activity_at,
       c.unread, c.status, c.status as source_status, c.assignee_membership_id,
       member.display_name as assignee_name, c.customer_id, contact.name as customer_name
  from public.conversations c
  left join public.contacts contact on contact.organization_id = c.organization_id and contact.id = c.customer_id
  left join public.memberships member on member.organization_id = c.organization_id and member.id = c.assignee_membership_id
union all
select t.organization_id, t.id, 'website'::text, 'web'::text,
       coalesce(contact.name, 'Website visitor ' || left(t.id::text, 8)), ''::text,
       null::text, left(coalesce(entry.body, ''), 200), greatest(t.updated_at, coalesce(entry.created_at, t.updated_at)),
       null::boolean, case when t.state in ('resolved', 'closed') then 'closed' else 'open' end,
       t.state, member.id, member.display_name, t.customer_id, contact.name
  from public.communication_threads t
  left join public.contacts contact on contact.organization_id = t.organization_id and contact.id = t.customer_id
  left join public.memberships member on member.organization_id = t.organization_id and member.user_id = t.claimed_by
  left join lateral (
    select e.body, e.created_at from public.communication_entries e
     where e.organization_id = t.organization_id and e.thread_id = t.id
     order by e.created_at desc, e.id desc limit 1
  ) entry on true
 where t.channel = 'web';
revoke all on public.conversation_feed from public, anon, authenticated;
grant select on public.conversation_feed to authenticated;
