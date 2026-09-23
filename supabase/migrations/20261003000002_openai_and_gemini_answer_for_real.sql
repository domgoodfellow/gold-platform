-- Two Provider Services move from catalogued to implemented, now that an adapter exists.
--
-- `implementation_state = 'available'` is a claim `record_ai_runtime_assignment` checks before
-- accepting an assignment (prior migration) -- it must be true only for a service this runtime can
-- actually answer through, never merely one a credential has been configured for. `openai.responses`
-- and `google.gemini_interactions` now have one (`app.providers.openai.answering`,
-- `app.providers.google.answering`); every other AI provider service seeded in Slice 4 --
-- realtime, embeddings, speech, Gemini Live, managed agents, distribution -- stays `planned`,
-- because none of them do yet.

update public.platform_provider_services
   set implementation_state = 'available',
       updated_at           = now()
 where provider_key = 'openai' and key = 'responses';

update public.platform_provider_services
   set implementation_state = 'available',
       updated_at           = now()
 where provider_key = 'google' and key = 'gemini_interactions';
