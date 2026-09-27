-- The customer-facing name of the lower AI tier is AI Standard (D67). The key stays `ai_lite`:
-- grants, assignments and agreements reference it, and a key rename buys nothing a label does not.
update public.platform_plans
   set label = 'AI Standard',
       description = 'AI Standard add-on.'
 where key = 'ai_lite';
