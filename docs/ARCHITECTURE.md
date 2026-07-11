# Architecture Notes

For product/system-design explanations, use `docs/reference/` alongside this architecture map. The reference docs describe current behavior and intentionally synthesize implemented specs rather than preserving all historical spec details.

## Workspace layout

Penge is a pnpm monorepo:

- `apps/web/` is the TanStack Start application. It owns the browser UI, Better Auth, Zero, Drizzle schema/migrations, and web-facing server functions.
- `apps/eve/` owns the Eve finance assistant and authorized default chat channel. Browser traffic always enters through `apps/web` authorization boundaries.
- `packages/domain/` contains shared domain/database code used by the web app and Eve runtime, including schema exports, categorization services, read projections, money helpers, and runtime service capabilities.

The Eve runtime exposes one authenticated `chat-session` finance assistant with scoped finance reads, approval-gated chat writes, and constrained workspace file tools. Model-callable schemas never accept authority fields; every tool re-reads trusted scope from Eve session auth and delegates finance behavior to `@penge/domain`. Successful write results are committed to the server-only `agent_tool_executions` ledger in the same transaction as domain changes so durable Eve replay is idempotent.

Eve sandbox state is sensitive per-session working memory under `/workspace`, never app-owned state or Zero data. The runtime disables all default tools and dynamically restores only `read_file`, `write_file`, `glob`, and `grep` for chat. Sandbox egress is deny-all on Vercel, Docker, and microsandbox; just-bash has no real network. This policy does not constrain authored tools, which execute in the app runtime.

Run commands from the workspace root by default. Package-local source paths in docs generally refer to `apps/web/src/...` for web code and `apps/eve/agent/...` for Eve code.

## AI runtime boundaries

Ask Penge uses Eve's default conversation channel through the same-origin `/api/eve/chat/:chatId/eve/v1/session*` proxy. The browser addresses an app-owned chat id and never receives a direct Eve host, service bearer, continuation token, or authority header. On every request, `apps/web` authenticates the Better Auth cookie, authorizes chat ownership and current team membership, validates the exact route/body/origin, and mints a short-lived capability limited to `{purpose: 'chat-session', userId, teamId, chatId}`. The Eve channel verifies that capability and tools read scope only from Eve session auth.

Eve's durable stream is the chat transcript and approval source of truth. The browser replays it from index zero through the stateless sanitizer, then `useEveAgent` owns live streaming, reduction, optimistic messages, and reconnection. App Postgres stores only chat metadata and server-only Eve session/continuation handles; Zero syncs the chat list, not transcript or approval events. A completed or failed Eve session leaves its product chat read-only.

Automated transaction categorization is currently removed. A future version should use a lightweight app-visible status row and cursor without mirroring Eve events.

For local development, run web and Eve as separate processes. The web app uses the Eve runtime base URL and service-capability secret; Eve uses the corresponding shared secret and a non-web port.

Local env files are generated per checkout by `scripts/dev.mjs` from `dev.config.mjs`. The generated root `.env` supplies `COMPOSE_PROJECT_NAME` plus isolated web, Eve, Postgres, Zero, and Zero change-streamer ports. Generated `apps/web/.env` and `apps/eve/.env` sync the shared database URL, runtime URL/capability secret, and package-specific port settings while preserving unmanaged local secrets.

Use `just init` to generate or refresh env files for the current checkout. Use `just worktree-create <branch>` and `just worktree-remove <branch>` for project-local `.worktrees/<branch-slug>` checkouts so Docker containers, networks, volumes, ports, and generated env files stay isolated. Do not run `git worktree add` directly in this repository.

Start the apps from the workspace root with `just dev`, `just dev-web`, or `just dev-eve` (or equivalent package-filtered commands). `just dev` starts web and Eve. Package scripts include fallback localhost ports for non-managed setups, but normal local work should use generated env values.

## Client/server import boundaries

TanStack Start builds client and server environments from overlapping route modules, so server-only dependencies must be explicit.

Use TanStack import-protection markers at the top of boundary-only modules:

```ts
import '@tanstack/react-start/server-only'
```

Use this for modules that touch secrets, Postgres, Drizzle server adapters, Better Auth server instances, or `@rocicorp/zero/server`. These modules must not be imported directly by client components or shared route code.

```ts
import '@tanstack/react-start/client-only'
```

Use this only for modules that cannot run during SSR.

Shared modules, route components, and `createServerFn` wrappers should stay marker-free unless they are truly one-environment-only. If shared code needs server work, call a server function or dynamically import a marked server module from inside server-only execution.

## Zero-backed app data reads and writes

Zero is the required read and write path for app/domain data that is exposed through the Zero schema.

If an app/domain table is included in `apps/web/drizzle-zero.config.ts`, then user-facing reads and writes for that table must go through Zero queries and Zero mutators. Do not add TanStack server functions, ad-hoc route handlers, or direct client-callable APIs for ordinary CRUD or domain updates on Zero-backed tables.

Server functions are reserved for special cases where Zero is not the right boundary, including:

- authentication/session helpers
- external-provider orchestration such as starting a bank link or manually triggering a provider sync
- tables intentionally excluded from Zero, such as Better Auth tables
- operational endpoints that do not expose or mutate app/domain rows directly

Zero mutators must still authorize server-side using the authenticated Zero context. Client-side filters, hidden UI, and client-supplied team ids are not authorization. The trusted-scope shortcut used by Eve/domain downstream code only applies after a server boundary has validated team membership.
