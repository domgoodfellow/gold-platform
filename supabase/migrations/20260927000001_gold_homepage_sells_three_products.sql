-- The homepage's default content shipped once reading like an internal design document rather
-- than sales copy, with a single request-a-conversation door in. The commercial decision
-- changed — three named products (Sales, Operations, Customer Service), each with its own page,
-- and "Request a demo" as the one public conversion route. `app.default_gold_homepage_sections()`
-- is immutable and already applied, so it is replaced here rather than edited in place; the
-- section vocabulary itself (six kinds, the same shape) is unchanged, so no validator needs to
-- move.
--
-- This only reaches a *fresh* bootstrap (`app.bootstrap_gold_public_site`, called once, on
-- conflict do nothing beyond the site row). GOLD's own already-published homepage, if one
-- exists, keeps its current revision until somebody drafts, reviews and publishes a new one
-- through the ordinary editor — the same review semantics every other tenant's homepage gets.

create or replace function app.default_gold_homepage_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select $json$[
    {"kind":"hero","eyebrow":"One system, not six","heading":"Run your business from one connected system.","body":"GOLD brings your sales, customers, communication, scheduling, work, automation, payments and reporting together — then configures itself around how your business actually runs.","primaryCta":{"label":"Request a demo","href":"/demo"},"secondaryCta":{"label":"See how GOLD works","href":"#how-it-works"}},
    {"kind":"problem","heading":"The problem isn’t one bad tool. It’s the gap between all of them.","paragraphs":["Customer details live in one place. Calls and texts happen somewhere else. Jobs get tracked in a spreadsheet, and nobody has one view of what a customer is waiting on.","GOLD keeps that information together, so the next call, quote or job starts from the full picture instead of another round of asking the customer to repeat themselves."]},
    {"kind":"capabilities","eyebrow":"Three ways in","heading":"Pick where GOLD helps first.","body":"Sales, Operations and Customer Service each stand on their own — turn on what your business needs now, and add the rest later.","items":[{"title":"Sales","body":"Turn leads into customers without losing the conversation."},{"title":"Operations","body":"Know what needs to happen, who is doing it, and what happens next."},{"title":"Customer Service","body":"Give customers one conversation with your business."}]},
    {"kind":"process","eyebrow":"How it works","heading":"You review every step before it goes live.","items":[{"step":"01","title":"See how you work today","body":"A short conversation about the tools you use now and where they fall short."},{"step":"02","title":"Configure your workspace","body":"Your services, pricing, hours and roles get set up — not a template, your operation."},{"step":"03","title":"Review and launch","body":"Test the real workflows with your team, then launch only when you’re ready."},{"step":"04","title":"Improve over time","body":"Turn on more of GOLD as the business needs it, without starting over."}]},
    {"kind":"trust","eyebrow":"Why GOLD","heading":"Built so you can trust what it does.","items":[{"title":"Your data stays yours","body":"Every business’s records stay separate, from the screen through the database."},{"title":"A person stays in the loop","body":"AI can draft and assist; it does not act or publish on its own."},{"title":"Configured for you, not a template","body":"Your work types, pricing and roles reflect how you actually run — no fork to maintain."},{"title":"You decide when to launch","body":"Nothing goes live for your business until you’ve reviewed it."}]},
    {"kind":"cta","heading":"Run your business from one connected system.","body":"Request a demo and we’ll show you where GOLD fits — starting with the parts your business needs most.","primaryCta":{"label":"Request a demo","href":"/demo"},"secondaryCta":{"label":"Prefer to explore independently? Create an account.","href":"/sign-up"}}
  ]$json$::jsonb;
$fn$;
