-- Replace the zero UUID with the one approved Organization. Read-only operational diagnostics.
-- Does not return recipients, confirmation bodies, credentials or webhook payloads.
begin read only;
with scope as (
  select '00000000-0000-0000-0000-000000000000'::uuid as organization_id
), jobs as (
  select j.* from app.notification_jobs j join scope s using (organization_id)
), intents as (
  select i.* from public.service_notification_intents i join scope s using (organization_id)
), events as (
  select e.* from public.message_events e join jobs j
    on j.organization_id=e.organization_id and j.message_id=e.message_id
), accepted as (
  select j.message_id, min(e.occurred_at) as accepted_at
    from jobs j join events e on e.organization_id=j.organization_id and e.message_id=j.message_id
   where e.event_type='accepted' group by j.message_id
)
select jsonb_build_object(
  'organization_id', (select organization_id from scope),
  'intents', (select count(*) from intents),
  'not_requested', (select count(*) from intents where state='not_requested'),
  'suppressed_intents', (select count(*) from intents where state='suppressed'),
  'queued_jobs', (select count(*) from jobs where state='queued'),
  'due_jobs', (select count(*) from jobs where state='queued' and next_attempt_at<=now()),
  'oldest_due_seconds', (select extract(epoch from now()-min(next_attempt_at))
    from jobs where state='queued' and next_attempt_at<=now()),
  'sending_jobs', (select count(*) from jobs where state='sending'),
  'expired_leases', (select count(*) from jobs where state='sending' and lease_until<=now()),
  'retrying_jobs', (select count(*) from jobs where state='queued' and attempts>0),
  'jobs_with_three_claims', (select count(*) from jobs where attempts>=3 and state in ('queued','sending','failed')),
  'failed_jobs', (select count(*) from jobs where state='failed'),
  'recent_failed_attempts', (select count(*) from public.service_notification_attempts a join scope s using(organization_id)
    where a.started_at>now()-interval '15 minutes' and a.outcome in ('retry','failed','rejected','lease_expired')),
  'recent_rejections', (select count(*) from events where event_type='rejected' and occurred_at>now()-interval '15 minutes'),
  'recent_bounces', (select count(*) from events where event_type='bounced' and occurred_at>now()-interval '15 minutes'),
  'recent_suppressions', (select count(*) from public.email_recipient_suppressions p join scope s using(organization_id)
    where p.created_at>now()-interval '15 minutes'),
  'accepted_without_sent_or_terminal_after_15m', (select count(*) from accepted a
    where a.accepted_at<now()-interval '15 minutes' and not exists (
      select 1 from events e where e.message_id=a.message_id
        and e.event_type in ('sent','delivered','bounced','failed','rejected','complained'))),
  'latest_provider_event_at', (select max(provider_event_at) from events),
  'latest_provider_ingestion_at', (select max(occurred_at) from events where provider_event_id is not null
    and provider_event_id not like 'send:%')
) as notification_readiness;
rollback;
