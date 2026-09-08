# Flue chat

The sidebar uses Flue **2.0.3** end to end: `@flue/react` → authenticated
same-origin web proxy → private Flue HTTP server → `Assistant` with a local
sandbox. OpenAI is the default. Mocking is optional, for CI, E2E tests and orbs.

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Flue only | Your OpenAI API key. Required for the default model. |
| `FLUE_MODEL` | Flue only | Optional `provider/model`, default `openai/gpt-5.5`. For example `openai/gpt-4.1-mini` or `anthropic/claude-sonnet-4-6`. |
| `FLUE_MOCK` | Flue only | Set **`1`** to use the deterministic mock regardless of model/keys. Unset or `0` uses the real provider. |
| `FLUE_INTERNAL_TOKEN` | Flue and web | The same private service credential in both processes; not a provider key. |
| `PORT` | Flue | HTTP port; use **3200**, matching the web proxy. |

Flue's standard built-in providers are registered. Other providers require their
own credential, e.g. `ANTHROPIC_API_KEY` for Anthropic. Models must exist in the
installed provider catalog. No automatic fallback to mocks occurs on missing
credentials or provider errors. Restart Flue after changing its environment.

Never use a `VITE_*` variable for a provider key or internal token. CLI and Vite
dev load `apps/flue/.env`; shell-exported values win. The **built server does not
load `.env`**, so export credentials into its process environment.

## Local setup and sidebar chat

Use Node >=22.19.0, pnpm, Docker and `just`. The Flue project is already scaffolded;
do **not** run `flue init` again.

For a fresh, disposable checkout only, `just init` installs dependencies and
generates local env files, but **resets and seeds the local database**. For an
already initialized checkout, use `pnpm install --frozen-lockfile` instead.

From the repository root, generate the internal credential once (preserving an
existing token) and build Flue:

```sh
mkdir -p .local
test -s .local/flue-token || (umask 077; openssl rand -hex 32 > .local/flue-token)
pnpm --filter @penge/flue build
```

Terminal 1, with your `OPENAI_API_KEY` already exported:

```sh
FLUE_MOCK=0 FLUE_INTERNAL_TOKEN="$(cat .local/flue-token)" PORT=3200 \
  pnpm --filter @penge/flue start
```

Terminal 2:

```sh
FLUE_INTERNAL_TOKEN="$(cat .local/flue-token)" just dev
```

Open the web dev URL printed by Vite, sign in, then open **Chat**. `just dev`
starts the web app, Zero and the database; Flue runs separately. For mock sidebar
chat, change `FLUE_MOCK=0` to `FLUE_MOCK=1` in Terminal 1. No web-side mock flag
is required. Rebuild and restart Flue after runtime code changes.

CLI-only real and mocked runs (from the repository root):

```sh
FLUE_MOCK=0 pnpm --filter @penge/flue exec flue run src/agents/assistant.ts --message "Hi" --id local-chat
pnpm --filter @penge/flue mock --message "Hi" --id mock-check --env /dev/null
```

`--id` resumes a conversation; use a different id for mock testing. Sidebar
history is shared across provider changes, so prior mock replies remain visible.

## CI, E2E and orbs — no provider calls

```sh
pnpm --filter @penge/flue test
pnpm --filter @penge/flue check:types
```

Tests spawn isolated processes without inherited credentials or developer env
files. They exercise mock CLI/HTTP/sandbox runs, persistence, concurrent users,
missing OpenAI credentials, and the real OpenAI provider with intercepted HTTP
responses (default and overridden model). No real provider calls are made.

In an orb:

```sh
.agents/setup
amp orb services ensure
```

The existing manifest intentionally keeps Flue in `FLUE_MOCK=1` with a scrubbed
environment, even if the orb has provider keys. Setup installs/builds/tests it
and creates the private token; resume checks artifacts without reinstalling.
Use the printed portal. Run browser tests against it with
`FLUE_MOCK=1 VITE_PUBLIC_APP_URL=<portal-origin> pnpm --filter @penge/web test:e2e`.
The E2E flag enables the test; the sidecar must also be running in mock mode.

## Boundaries and limits

- `local()` gives the model **real host filesystem and shell access**, not an
  isolation boundary. Real model tool calls are no longer restricted to the
  mock's fixed `printf`. Use only for trusted local development; do not expose
  this as an untrusted multi-tenant service. No finance tools are connected, but
  host access can reach local files. Keep sensitive data off the runtime host.
- One private conversation per authenticated user/personal team. The web proxy
  derives the id and verifies membership on every request; it rejects external
  ids, authority fields, attachments and cross-origin writes. The runtime
  requires the internal bearer on all conversation routes. `/health` is public.
- Use the built runtime behind the web proxy, not a publicly exposed Vite dev
  server. Vite's source/debug routes are outside the runtime's authentication.
- SQLite in `apps/flue/data/flue.db`; one live Node owner. No multi-host
  coordination, retention, quotas or long-lived stream reauthorization.
- Mock responses are explicitly labeled in their text. Only the model is mocked;
  the fixed sandbox check, Flue transport and persistence remain real.
- Zero uses the same-origin `/zero` Vite proxy locally. Production needs an
  equivalent reverse proxy or a separately authenticated Zero origin.

The UI uses `@shadcn/react` MessageScroller from Flue's official demo, plus the
existing shadcn primitives. The native Flue hook owns streaming/history; there
is no custom protocol reducer. Installed docs are authoritative:
`pnpm --filter @penge/flue exec flue docs read guide/models`.
