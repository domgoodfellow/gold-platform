# GildOps API

`apps/api` hosts Python serverless domain/provider handlers and a Node function for imported open-source connectors (ADR-041). Tenant connections, grants, Vault credentials and execution auditing remain canonical.

It is **not** a general-purpose REST resource API.

That is why most logical routes are `POST`:

- webhooks deliver events;
- commands request an operation;
- provider/integration endpoints perform controlled actions;
- AI endpoints execute a task;
- scheduler endpoints trigger work.

Resource reads for the operator application normally occur through the authenticated web/domain/database path rather than through a second Python CRUD API.

## Runtime shape

Production:

```text
Vercel
↓
one Python handler file under apps/api/api/
↓
apps/api/app/
↓
narrow database/provider operation
```

Local development:

```bash
python apps/api/dev.py
```

Run the connector worker separately with `pnpm --filter @gold/integration-library library:dev`. It binds to loopback port 5322; set `GILDOPS_LIBRARY_URL=http://127.0.0.1:5322` and the same `GILDOPS_LIBRARY_SECRET` in both processes. The Node worker also needs the existing integration database settings. No Activepieces account is required. See `docs/integrations.md` and `docs/deployment.md` for configuration and supported operations.

The local router reads `apps/api/vercel.json`.

Do not maintain a separate local route registry.

Default local address:

```text
http://127.0.0.1:8787
```

## Route authority

The executable logical-route mapping is:

```text
apps/api/vercel.json
```

Physical handler files live under:

```text
apps/api/api/
```

Architecture tests keep handler inventory, rewrites and tests aligned.

Do not treat this README as the executable route registry.

## Current route classes

The current Vercel configuration includes logical routes for:

- Stripe tenant-payment webhook;
- Stripe platform-billing webhook;
- automation scheduler tick;
- consent-based customer service email delivery tick;
- operator AI ask;
- AI configuration drafting;
- CRM stage command;
- Voice call wrap-up;
- inbound/outbound routing preview;
- tenant integration operations;
- Platform provider operations;
- Organization web-domain operations;
- Organization email-domain operations;
- Voice inbound/outbound/status/recording callbacks;
- SMS inbound/status callbacks;
- public-site assistant;
- invitation email;
- invitation email webhook;
- tenant email send;
- tenant email webhook.

Check `vercel.json` before adding or documenting a route.

Customer notification delivery uses the existing tenant-email provider adapter and sender's
provider account, with no invitation-sender or environment-key fallback. Its scheduled GET is
protected by `CRON_SECRET` and uses the existing provider runtime settings to mint the narrow
notification-worker identity. Database claims, pre-send authorization and fenced results own
eligibility, leases, retry bounds and canonical message evidence. Deploying code alone does not
prove that a tenant sender, provider account credential or signed delivery webhook is ready.

## HTTP methods

Methods follow the operation.

Most commands and webhooks use:

```text
POST
```

The scheduler handler may accept the method(s) required by the local/hosted scheduler contract.

Do not add `GET` merely to make the API look REST-like.

Use `GET` only for a genuinely safe read or scheduler/provider contract that requires it.

## Authentication boundaries

Different callers use different trust proofs.

### Human caller

Human-authenticated commands receive the caller's Supabase bearer token.

The API authentication boundary verifies the identity.

Authorization remains with:

- RLS;
- domain operations;
- explicit Platform checks;
- entitlement checks where applicable.

### Provider webhook

Provider authenticity is verified before privileged mutation.

The provider payload does not choose tenant authority merely by naming an Organization.

### Scheduler / machine actor

Scheduled and machine operations use narrow machine authority.

Do not substitute a broad service-role database client.

See:

- `docs/security.md`
- `docs/architecture.md`
- `docs/integrations.md`

## Layout

```text
apps/api/
  api/
    one deployed handler per physical entrypoint

  app/
    auth/
    core/
    domains/
    providers/
    connectors/
    ai/
    channels/
    conditions/
    ...

  dev.py
  vercel.json
  requirements.txt
  requirements-dev.txt
  tests/
```

`app/domains/` contains only the narrow cross-runtime commands that genuinely require the Python boundary.

It is not a second copy of `apps/web/lib/domain`.

## Dependencies

Production dependencies are declared in:

```text
apps/api/requirements.txt
```

Development/test dependencies are declared in:

```text
apps/api/requirements-dev.txt
```

This runtime is based on Vercel Python `BaseHTTPRequestHandler` handlers.

It is **not FastAPI**.

Do not add FastAPI documentation or assumptions unless the runtime is deliberately migrated.

## Environment

Copy:

```text
apps/api/.env.example
```

to:

```text
apps/api/.env
```

for local development.

The example file is the variable-name/classification contract.

Do not duplicate the full environment-variable inventory here.

Hosted environment procedure belongs in `docs/deployment.md`.

Local setup belongs in `docs/development.md`.

## Provider boundaries

Provider-specific code belongs under the provider/adapter boundary.

Domain/application code should consume capability-shaped operations.

Never move a provider secret into browser-visible configuration merely because the initiating action starts in the web app.

## Testing

API tests:

```bash
pnpm test:api
```

or:

```bash
python -m pytest apps/api/tests -q
```

Provider protocol behavior should use the appropriate contract test.

Live provider verification is separate and must be reported as such.

See `docs/testing.md`.

## Adding an endpoint

Before adding a handler:

1. identify the owning domain/capability;
2. determine why the operation belongs in Python rather than the web/domain path;
3. define authentication/trust proof;
4. define authorization and Organization resolution;
5. define idempotency if retry is possible;
6. add the handler;
7. add the logical rewrite to `vercel.json`;
8. add tests;
9. update route documentation only if the route class/operational contract materially changed.

Do not create a generic Python CRUD API parallel to the existing application/domain layer.
