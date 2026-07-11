# Penge

Penge is a local-first budgeting app workspace.

## Workspace layout

```txt
.
├─ apps/
│  ├─ web/    # TanStack Start app, Zero client/server, Drizzle schema and migrations
│  └─ eve/    # Eve finance assistant and categorization runtime
├─ packages/
│  └─ domain/ # Shared domain and database code
└─ docs/
```

## Requirements

- Node.js 24+
- pnpm
- Docker
- just

## Setup

```bash
cp apps/web/.env.example apps/web/.env
cp apps/eve/.env.example apps/eve/.env
just setup
```

The web app owns browser-facing authorization and product state. Eve runs as an internal sidecar; browser requests reach it only through Penge-owned routes.

### Amp orbs

`.agents/setup` prepares Node 24.20.0, pnpm 10.34.5, just, locked workspace
dependencies, Playwright Chromium, and PostgreSQL 18. Amp snapshots these files
for reuse by fresh orbs. Warm setup rechecks dependencies and applies migrations;
`.agents/resume` only checks the prepared files, with no installs or downloads.

Orbs use native PostgreSQL instead of Docker. Start it with
`amp orb services ensure`, then run `pnpm test`, `pnpm typecheck`, or `pnpm build`.
The isolated `.local/orb-postgres` cluster contains migrated `penge` and
`penge_test` databases, with logical replication enabled. Its durability settings
are intentionally relaxed for disposable development data. Setup never resets
existing data or imports the private seed dump.

Missing app `.env` files are copied from the examples without replacing existing
files. External bank and AI integrations still need project secrets; setup does
not authenticate users or populate real financial data.

Do not use `just setup`, `just init`, or Docker-based `just dev`/`db-*` recipes in
orbs. To run the app, supervise `pnpm dev:web` and `pnpm dev:flue` with
`amp orb service start`. Playwright's default server command is `just dev`, so
start the app first and use its existing-server mode (`CI` unset). Portal origin
and Zero proxy configuration are separate from this dependency setup.

## Development

```bash
just dev
```

App: https://localhost:3100
Zero cache: http://localhost:4848
Eve runtime: http://localhost:3300

Run one service with `just dev-web` or `just dev-eve`.

## Database

```bash
just db-generate
just db-migrate
just db-reset
```

Postgres runs in Docker with `wal_level=logical` so Zero can replicate changes. Eve runtime persistence is separate from Penge app/domain tables and is excluded from Zero. The explicit `penge_zero_app` publication contains only app/domain tables.

## Tests and checks

```bash
just test-unit
just test-e2e
just check
```

`just check` runs Knip before package lint, typecheck, and test commands. Useful package-scoped checks include:

```bash
pnpm --filter @penge/web typecheck
pnpm --filter @penge/eve typecheck
pnpm --filter @penge/domain typecheck
```

## Zero

Generate the Zero schema from Drizzle with:

```bash
just zero-generate
```

Do not hand-edit `apps/web/src/zero/schema.ts`. If the publication table set changes, run `just zero-reset` before restarting development.
