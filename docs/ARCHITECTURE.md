# Architecture Notes

For product/system-design explanations, use `docs/reference/` alongside this architecture map. The reference docs describe current behavior and intentionally synthesize implemented specs rather than preserving all historical spec details.

## Workspace layout

Penge is a pnpm monorepo:

- `apps/web/` is the TanStack Start application. It owns the browser UI, Better Auth, Zero, Drizzle schema/migrations, and web-facing server functions.
- `apps/flue/` is the Flue sidecar service. It owns Flue agents, workflows, tools, model calls, and Flue runtime persistence.
- `packages/domain/` contains shared domain/database code used by both the web app and Flue, including schema exports, categorization services, read projections, money helpers, and workflow-run repository helpers.

Run commands from the workspace root by default. Package-local source paths in docs generally refer to `apps/web/src/...` for web code and `apps/flue/src/...` for Flue code.

## Flue sidecar boundary

Flue runs as a separate Node-target service, not inside the TanStack Start runtime. The web app should authenticate users and call Flue over an internal service boundary for agent workflows. Flue may update Postgres through trusted domain logic; Zero observes committed domain-table changes and syncs them back to clients. Flue does not talk to Zero directly.

First-slice web-to-Flue auth uses `PENGE_FLUE_INTERNAL_TOKEN` and passes trusted `userId` plus `teamId` in workflow input. This is temporary tech debt tracked in `docs/TODO.md`; the long-term goal is a least-privilege API/capability boundary where Flue cannot read or write data outside the authenticated user's authorized scope.

For local development, run the web app and Flue sidecar as separate processes. The web app needs `PENGE_FLUE_BASE_URL` pointing at the Flue server and `PENGE_FLUE_INTERNAL_TOKEN`; the Flue app needs the same token and should use a non-web port. The example env files use:

```txt
apps/web/.env:  PENGE_FLUE_BASE_URL=http://localhost:3101
apps/web/.env:  PENGE_FLUE_INTERNAL_TOKEN=change-me
apps/flue/.env: PORT=3101
apps/flue/.env: PENGE_FLUE_INTERNAL_TOKEN=change-me
```

Start them from the workspace root with `pnpm dev:web` and `pnpm dev:flue` (or equivalent package-filtered commands).

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

Zero mutators must still authorize server-side using the authenticated Zero context. Client-side filters and hidden UI are not authorization.
