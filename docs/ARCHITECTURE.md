# Architecture Notes

For product/system-design explanations, use `docs/reference/` alongside this architecture map. The reference docs describe current behavior and intentionally synthesize implemented specs rather than preserving all historical spec details.

## Workspace layout

Penge is a pnpm monorepo:

- `apps/web/` is the TanStack Start application. It owns the browser UI, Better Auth, Zero, Drizzle schema/migrations, and web-facing server functions.
- `apps/flue/` is the private Flue v2 Node agent runtime, with explicit model mocks and a local sandbox. The web app's same-origin authenticated chat proxy connects its sidebar to Flue's standard React/SDK transport. See its README for execution and safety limits.
- `packages/domain/` contains domain/database code used by the web app, including schema exports, categorization services, category management, and money helpers.

Run commands from the workspace root by default. Package-local source paths in docs generally refer to `apps/web/src/...` for web code.

The chat sidebar is a mock-only integration demo, not a financial assistant. There is no automated transaction categorization. Existing financial interpretations and historical provenance remain reviewable through the normal app. Flue owns its separate SQLite conversation state; it does not read or write Zero-backed financial data.

## Local development

Local env files are generated per checkout by `scripts/dev.mjs` from `dev.config.mjs`. The generated root `.env` supplies `COMPOSE_PROJECT_NAME` plus isolated web, Postgres, Zero, and Zero change-streamer ports. Generated `apps/web/.env` syncs database URLs and service ports while preserving unmanaged local secrets.

Use `just init` to generate or refresh env files for the current checkout. Use `just worktree-create <branch>` and `just worktree-remove <branch>` for project-local `.worktrees/<branch-slug>` checkouts so Docker containers, networks, volumes, ports, and generated env files stay isolated. Do not run `git worktree add` directly in this repository.

Start the app from the workspace root with `just dev` or `just dev-web`. Package scripts include fallback localhost ports for non-managed setups, but normal local work should use generated env values.

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

Zero mutators must still authorize server-side using the authenticated Zero context. Client-side filters, hidden UI, and client-supplied team ids are not authorization.
