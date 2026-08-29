# `apps/api`

The Python plane. Webhook ingress today; automation, intelligence and realtime later (D2).

Writes no table. Handlers verify, then call a `SECURITY DEFINER` function that derives every
consequential value itself.

## Layout

```text
app/
  core/                configuration, database handle
  integrations/
    stripe/            signature check and event parsing
  api/                 HTTP entrypoints — one file, one route
tests/
```

`domains/`, `ai/`, `workers/` — not created until something goes in them.

## Routes

| Route                   | Handler                      |
| ----------------------- | ---------------------------- |
| `POST /webhooks/stripe` | `app/api/stripe_webhook.py`  |

## Environment

All four required, or the handler returns 404.

| Variable                | Notes                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `SUPABASE_URL`          |                                                                        |
| `SUPABASE_ANON_KEY`     |                                                                        |
| `SUPABASE_JWT_SECRET`   | Signs a 60s token for the `payment_webhook` role. **Not** service-role. |
| `STRIPE_WEBHOOK_SECRET` |                                                                        |

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
python -m pytest apps/api/tests
```

⚠️ **Not covered by `pnpm --filter @gold/web check`.** Run both.
