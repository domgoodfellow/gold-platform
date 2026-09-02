# `apps/api`

The Python plane. Webhook ingress today; automation, intelligence and realtime later (D2).

Writes no table. Handlers verify, then call a `SECURITY DEFINER` function that derives every
consequential value itself.

## Layout

```text
app/
  core/                configuration, database handles, the caller-token client
  ai/                  the tool loop, the tool registry, the provider registry
  channels/            sending a message to a person, as a capability
  conditions/          what the world is doing at a place, as a capability
  integrations/
    stripe/            signature check and event parsing
    anthropic/         the default model behind the answering capability
    openai_dialect/    anything speaking chat completions, including a local model
  api/                 HTTP entrypoints — one file, one route
tests/
```

`domains/` and `workers/` — not created until something goes in them.

`ai/` exists as of M8's first criterion and holds **no SQL and no arithmetic**. A tool is a
`stable`, `security invoker` function in Postgres; this package holds its name, its sentence and
its JSON schema, and the loop that decides when to call it (D34).

## Routes

| Route                        | Handler                       |
| ---------------------------- | ----------------------------- |
| `POST /webhooks/stripe`      | `app/api/stripe_webhook.py`   |
| `GET/POST /tasks/automation-tick` | `app/api/automation_tick.py` |
| `POST /ai/ask`               | `app/api/ai_ask.py`           |

## Environment

Each feature reads its own, and a missing value switches that feature off rather than breaking
the deployment — a handler with nothing configured returns 404.

| Variable                | Notes                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `SUPABASE_URL`          |                                                                        |
| `SUPABASE_ANON_KEY`     |                                                                        |
| `SUPABASE_JWT_SECRET`   | Signs a 60s token for the `payment_webhook` and `automation_runner` roles. **Not** service-role. |
| `STRIPE_WEBHOOK_SECRET` |                                                                        |
| `CRON_SECRET`           | What the host's scheduler presents to the tick.                        |
| `ANTHROPIC_API_KEY`     | The default model behind `/ai/ask`.                                    |
| `ASSISTANT_BASE_URL`    | A chat-completions endpoint to answer with instead — a local model, or anything speaking that dialect. Set, it wins over the default. |
| `ASSISTANT_MODEL`       | Which model at that endpoint. Defaults to `llama3.1`.                  |
| `ASSISTANT_API_KEY`     | Optional, for a hosted endpoint that wants one. A model on your own hardware needs none. |

**`/ai/ask` signs nothing.** It forwards the access token of the person who asked, so every read
it performs happens inside that person's own RLS boundary. There is no role for this axis and no
secret it could substitute for one (D34).

## Local development

```bash
cp apps/api/.env.example apps/api/.env    # fill in from `pnpm db:start`
python apps/api/dev.py                     # serves on :8787
stripe listen --forward-to http://127.0.0.1:8787/webhooks/stripe
```

`stripe listen` prints a `whsec_…` — that is `STRIPE_WEBHOOK_SECRET` for the CLI, and it is
not the dashboard's endpoint secret. Restart `dev.py` after pasting it.

The web app needs `STRIPE_SECRET_KEY` (`sk_test_…`) in `apps/web/.env.local` for the outbound
half. Blank means no card control appears.

`dev.py` is development only; Vercel invokes handlers directly and `.vercelignore` excludes it.

## Deploy

Vercel Python functions (D24). No daemon; state that must survive an invocation goes in
Postgres.

Routes live at `app/api/`, not the top-level `api/` Vercel discovers by default —
`vercel.json` remaps it.

## Test

```bash
pnpm check            # both runtimes: apps/web, then these
python -m pytest apps/api/tests   # these alone, while iterating
```

**In the gate as of M8.** They were not, for two milestones, and the warning that used to sit
here said so. What changed is what this runtime does: two handlers that decided nothing were
tolerable outside the gate, and the tool loop is not. The root script runs pytest directly rather
than through pnpm, because this app is deliberately not a workspace member (D3) — so the gate
needs Python on the path.

## The automation tick

`/tasks/automation-tick` is the second endpoint and the responsibility `docs/constraints.md` D2
lists first for this runtime. It arrived with M6, and D24 decides its shape: **a scheduled
invocation that asks what is due, never a worker daemon.** There is no queue in this process —
`run_due_automations()` answers a query, and the message queue that does exist is a table.

It runs as `automation_runner`, a Postgres role holding **no grant on any table** and exactly
five `execute` grants (D30). It cannot read a customer or a job; `queued_messages` hands it an
address and the finished words a business wrote; `places_to_watch` hands it a point on a map and
a metric; and recording a delivery or a reading is all it can say back.

`CRON_SECRET` gates it. Without a match the endpoint answers 401, and without the four runner
settings it answers 404 — the same shape the Stripe handler uses for a deployment with no
processor.

**Channels are configured one at a time** (`app/channels/registry.py`), and a channel this
deployment cannot send on is not hidden: the message is recorded as failed with a sentence
saying so, which an operator reads on the Automations screen. That is D31 applied to a switch
whose inputs live in a different deployment.

Its tests are in `tests/test_automation_tick.py` and, like the rest of this directory, they are
**not in `pnpm --filter @gold/web check`** — run `python -m pytest apps/api/tests` alongside it.
