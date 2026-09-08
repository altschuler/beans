# Flue mock chat

The app's desktop sidebar/mobile sheet uses Flue **2.0.3** end to end:
`@flue/react` → same-origin authenticated web route → private Flue HTTP server
→ `Assistant` with `useModel('mock/local')` and `useSandbox(local())`.
There are no finance tools, automated categorization, or real-provider calls.

## Run in an orb

```sh
.agents/setup
amp orb services ensure
```

Open the printed **Penge — mock Flue chat** portal, sign up with a local demo
account, and open **Mock chat**. Any message runs the same fixed sandbox check.
The response reports the persisted number of user messages. Close/reopen or
reload to resume. A service outage shows a generic error and a Reconnect button;
a failed send preserves the input for manual resubmission.

Setup installs the locked dependencies, migrates the isolated PostgreSQL cluster,
builds/tests Flue, and generates a private `.local/flue-token`. Resume checks the
artifacts without installing. The manifest supervises PostgreSQL, Zero, Flue, and
web. Rebuild and restart Flue after runtime edits:

```sh
pnpm --filter @penge/flue test
amp orb service restart flue
```

The orb uses the **built** server, with an explicit environment and no `.env`
loading. Do not expose `vite dev`: Vite's own source/debug routes are outside
Hono authentication. Web's orb listener is HTTP behind the HTTPS Amp portal;
normal local development retains HTTPS. Zero's WebSocket uses the same-origin
`/zero` Vite proxy so Secure Better Auth cookies reach Zero and its authenticated
query/mutate callbacks. Existing local env files should set
`VITE_PUBLIC_ZERO_CACHE_URL=/zero`; production needs an equivalent reverse proxy
or a separately configured authenticated Zero origin.

CLI-only usage remains available, deliberately ignoring local env files:

```sh
pnpm --filter @penge/flue mock --message "Hi" --id example --json --env /dev/null
pnpm --filter @penge/flue check:types
pnpm --filter @penge/flue test
```

## Authorization and limits

- The browser addresses only `/api/chat/current` (and `/abort`). Every operation
  requires a Better Auth session and a persisted personal-team membership.
  The server derives the durable id from `[team.id, session.user.id]`; the browser
  cannot select another user's conversation, supply authority, signals, images,
  attachments, `initialData`, or an incarnation `uid`. Writes require same origin.
- The private runtime requires a server-only bearer credential on all conversation
  routes. Only `/health` is public and returns a fixed readiness string.
  It has no public portal. Never share that credential with a browser.
- Both runtime and web boundary require `FLUE_MOCK=1` and reject
  `NODE_ENV=production`. No real-provider path exists. The build registers zero
  built-in providers (`providers: []`); injected provider keys cannot select one.
- The only mocked boundary is Pi's model provider. Each model call owns a fresh
  faux queue and decides from its conversation context, so concurrent users and
  repeated submissions cannot consume each other's responses. It streams a fixed
  `bash` tool call, then a fixed reply only after checking the real result.
- `local()` is **not security isolation**: it can access the host filesystem.
  This mock never converts user text into commands. Its only command is a fixed
  `printf`; no host data or secrets are read. Never enable a real model or arbitrary
  tools on this sandbox without a new security design.
- The UI shows visible user/assistant text and a generic tool status, never raw
  tools, reasoning, system/advisory messages, or exception details. HTTP failures
  are sanitized; reads retain Flue's standard projected transcript protocol.
- One private conversation per user/personal team; SQLite in `data/flue.db`;
  one live Node owner. No multi-host coordination, retention, quota, production
  rollout, or long-lived stream reauthorization is implemented. This is a local
  integration demo, not a production multi-tenant agent service.

## Provenance

The Node HTTP/Vite files were folded in from a temporary
`@flue/cli@2.0.3 init --target node --deploy` scaffold, never `--force` over the
customized agent. The original CLI scaffold and durable agent identity remain.

The UI uses **`@shadcn/react` 0.3.1 MessageScroller**, also used by
[Flue's official shadcn demo](https://github.com/withastro/flue/tree/main/demo),
plus the app's existing shadcn Button, Textarea, and Sheet. This is presentation
only: the [native Flue React hook](https://flueframework.com/docs/guide/react/)
owns history, optimistic messages, SSE, reconnect, and long-poll fallback.
There is no AI SDK adapter or custom transport reducer.

Installed docs are authoritative:
`pnpm --filter @penge/flue exec flue docs read guide/react`
(also `guide/routing`, `reference/streaming-protocol`, `guide/node-target`).

Tests exercise the real CLI, HTTP runtime, local sandbox, concurrent identities,
restart persistence, and production rejection with credential-free child
environments. The web proxy tests use real PostgreSQL membership checks and
mock only session identity/upstream HTTP. Browser acceptance uses the real
signed-in app and Zero data, not fabricated UI messages.

Run the browser suite against the printed portal origin with
`FLUE_MOCK=1 VITE_PUBLIC_APP_URL=<portal-origin> pnpm --filter @penge/web test:e2e`.
The mock-chat case is explicitly skipped without `FLUE_MOCK=1`; the ordinary
app-shell smoke test still runs. In a 4 GB orb, use
`NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @penge/web test` to keep
Vitest's heap bounded while services run.
