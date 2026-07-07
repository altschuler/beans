# Penge

Penge is a local-first budgeting app workspace.

## Workspace layout

```txt
.
├─ apps/
│  ├─ web/   # TanStack Start app, Zero client/server, Drizzle schema and migrations
│  └─ flue/  # Flue sidecar scaffold for agent/workflow automation
├─ packages/
│  └─ domain/ # placeholder for shared domain/database code extracted as needed
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
cp apps/flue/.env.example apps/flue/.env
just setup
```

`apps/web/.env` is used by the web app, Drizzle, and Zero dev scripts. `apps/flue/.env` is used by `flue dev` / `flue run` for the sidecar.

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

Run the Flue sidecar separately when working on agent workflows:

```bash
just dev-flue
```

Flue dev server: http://localhost:3101

## Database

```bash
just db-generate
just db-migrate
just db-reset
```

Postgres runs in Docker with `wal_level=logical` so Zero can replicate changes. Flue runtime persistence uses the same Postgres database via separate `flue_*` tables. Zero dev uses the explicit `penge_zero_app` publication so those Flue runtime tables are not part of Zero's change stream.

## Tests and checks

```bash
just test-unit
just test-e2e
just check
```

`just check` runs Knip's unused-file/dependency checker before the package lint, typecheck, and test commands. Run it directly with:

```bash
pnpm knip
```

Useful package-scoped commands:

```bash
pnpm --filter @penge/web typecheck
pnpm --filter @penge/flue typecheck
pnpm --filter @penge/flue build
```

## Zero

The Zero schema is generated from the web app's Drizzle schema:

```bash
just zero-generate
```

Do not hand-edit `apps/web/src/zero/schema.ts`.

The database migration `apps/web/drizzle/0020_zero_publication.sql` creates the local `penge_zero_app` Postgres publication, which limits Zero replication to app/domain tables. If the publication table set changes, run `just zero-reset` before restarting dev so both the local replica and Zero's upstream dev metadata are rebuilt.
