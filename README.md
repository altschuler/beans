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

Postgres runs in Docker with `wal_level=logical` so Zero can replicate changes. Flue runtime persistence uses the same Postgres database via separate `flue_*` tables.

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
