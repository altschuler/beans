# Architecture Notes

For product/system-design explanations, use `docs/reference/` alongside this architecture map. The reference docs describe current behavior and intentionally synthesize implemented specs rather than preserving all historical spec details.

## Workspace layout

Penge is a pnpm monorepo:

- `apps/web/` is the TanStack Start application. It owns the browser UI, Better Auth, Zero, Drizzle schema/migrations, and web-facing server functions.
- `apps/flue/` is the existing Flue sidecar service. It owns current Flue agents, workflows, tools, model calls, and Flue runtime persistence during the migration.
- `apps/eve/` is the new eve runtime skeleton. It owns eve-authored agent files and internal channels for the Flue-to-eve migration spike; browser traffic must still enter through `apps/web` authorization boundaries.
- `packages/domain/` contains shared domain/database code used by the web app and runtime sidecars, including schema exports, categorization services, read projections, money helpers, runtime service capabilities, and workflow-run repository helpers.

The eve runtime uses one finance assistant with dynamic capabilities selected from authenticated session purpose. Chat sessions receive shared scoped finance reads, confirmed chat writes, and constrained workspace file tools. Categorization task sessions receive the same reads plus only the autonomous guarded categorization write. Model-callable schemas never accept authority fields; every tool re-reads trusted scope from eve session auth and delegates finance behavior to `@penge/domain`. Successful write results are committed to the server-only `agent_tool_executions` ledger in the same transaction as domain changes so durable eve replay is idempotent.

Eve sandbox state is sensitive per-session working memory under `/workspace`, never app-owned state or Zero data. The runtime disables all default tools and dynamically restores only `read_file`, `write_file`, `glob`, and `grep` for chat. Sandbox egress is deny-all on Vercel, Docker, and microsandbox; just-bash has no real network. This policy does not constrain authored tools, which execute in the app runtime.

Run commands from the workspace root by default. Package-local source paths in docs generally refer to `apps/web/src/...` for web code and `apps/flue/src/...` for Flue code.

## Flue sidecar boundary

Flue runs as a separate Node-target service, not inside the TanStack Start runtime. The web app should authenticate users and call Flue over an internal service boundary for agent workflows. Flue may update Postgres through trusted domain logic; Zero observes committed domain-table changes and syncs them back to clients. Flue does not talk to Zero directly.

First-slice web-to-Flue auth uses `PENGE_FLUE_INTERNAL_TOKEN` and passes trusted `userId` plus `teamId` in workflow input. The web boundary validates team access before constructing that scope; Flue tools ignore any model-supplied user/team fields and use the runtime scope. Domain read projections and trusted Flue write paths then filter directly by `teamId` and keep `userId` for audit/confirmation metadata.

This is temporary tech debt tracked in `docs/TODO.md`; the long-term goal is a least-privilege API/capability boundary where Flue cannot read or write data outside the authenticated user's authorized scope.

For local development, run the web app and Flue sidecar as separate processes. The web app needs `PENGE_FLUE_BASE_URL` pointing at the Flue server and `PENGE_FLUE_INTERNAL_TOKEN`; the Flue app needs the same token and should use a non-web port.

Local env files are generated per checkout by `scripts/dev.mjs` from `dev.config.mjs`. The generated root `.env` supplies `COMPOSE_PROJECT_NAME` plus isolated web, Flue, eve, Postgres, Zero, and Zero change-streamer ports. Generated `apps/web/.env`, `apps/flue/.env`, and `apps/eve/.env` sync the shared database URL, runtime URLs/tokens, and package-specific port settings while preserving unmanaged local secrets.

Use `just init` to generate or refresh env files for the current checkout. Use `just worktree-create <branch>` and `just worktree-remove <branch>` for project-local `.worktrees/<branch-slug>` checkouts so Docker containers, networks, volumes, ports, and generated env files stay isolated. Do not run `git worktree add` directly in this repository.

Start the apps from the workspace root with `just dev`, `just dev-web`, `just dev-flue`, or `just dev-eve` (or equivalent package-filtered commands). During the migration, `just dev` starts both Flue and eve so the eve spike can run without breaking current Flue-backed product paths. Package scripts still include fallback localhost ports for non-managed setups, but normal local work should use the generated env values.

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

Zero mutators must still authorize server-side using the authenticated Zero context. Client-side filters, hidden UI, and client-supplied team ids are not authorization. The trusted-scope shortcut used by Flue/domain downstream code only applies after a server boundary has validated team membership.
