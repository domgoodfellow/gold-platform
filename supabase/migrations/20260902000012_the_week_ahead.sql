-- What is already in the diary, so a suggestion is made against something rather than guessed.
--
-- **The third tool, and it exists because a model proposed a time without knowing what was
-- booked.** Watching a small local model handle *move it to 9am tomorrow* showed it had no way to
-- find out whether 9am tomorrow was free, whether the job it was moving even existed, or what
-- else that resource was doing. It guessed. The two tools before this answer *what is wrong*;
-- none of them answered *what does the week look like*, which is the question anybody moving a
-- job asks first.
--
-- **This is not `freeWindows` and must never become it** (I5, D30). It returns what is booked --
-- rows, in the business's own hours -- and computes no availability, suggests no slot and knows
-- nothing about operating hours or buffers. A model reading it may propose a time that looks
-- free, and the exclusion constraint is still what decides whether it lands (I6). That is
-- exactly the division D30 settled for automations, arriving on a second axis: assert an
-- instant, let the database arbitrate, record the refusal.
--
-- The day a business genuinely needs *the next free slot*, D30 names it as the trigger to
-- revisit -- and the answer will be a tool that calls the one availability calculation, never a
-- second one written here.
--
-- **Days ahead rather than two instants**, because a model supplying one integer gets it right
-- far more often than one supplying two timestamps -- and because the question is always some
-- number of days. The business's own zone decides where a day starts (I9).

create function public.schedule_ahead(
  p_organization_id uuid,
  p_days integer default 7
)
returns table (
  work_item_id uuid,
  title        text,
  status       text,
  starts_local text,
  ends_local   text,
  time_zone    text,
  resource     text,
  customer     text,
  starts_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select w.id,
         w.title,
         s.name,
         to_char(lower(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         to_char(upper(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         o.timezone,
         r.name,
         c.name,
         lower(w.scheduled_during)
    from public.work_items w
    join public.work_item_statuses s
      on s.organization_id = w.organization_id
     and s.id = w.status_id
    join public.organizations o
      on o.id = w.organization_id
    left join public.resources r
      on r.organization_id = w.organization_id
     and r.id = w.resource_id
    left join public.customers c
      on c.organization_id = w.organization_id
     and c.id = w.customer_id
   where w.organization_id = p_organization_id
     and w.scheduled_during is not null
     -- Work in a status the business marked as releasing its resource is off the board by that
     -- business's own definition, and showing it would make the diary look fuller than it is.
     and not w.status_releases_resource
     -- From the start of today in the business's own zone, so *this week* means what somebody
     -- there would mean by it rather than what UTC would.
     and upper(w.scheduled_during) >= date_trunc('day', now() at time zone o.timezone)
                                        at time zone o.timezone
     and lower(w.scheduled_during) < date_trunc('day', now() at time zone o.timezone)
                                        at time zone o.timezone
                                      + make_interval(days => greatest(p_days, 1))
   order by lower(w.scheduled_during);
$fn$;

comment on function public.schedule_ahead(uuid, integer) is
  'What is already booked over the next few days, in the business''s own hours. Rows, not availability: it computes no free slot and never will (I5). A tool: stable, security invoker. See D34.';

revoke execute on function public.schedule_ahead(uuid, integer) from public;
grant execute on function public.schedule_ahead(uuid, integer) to authenticated;
