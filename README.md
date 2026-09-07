# Penge

Penge is a local-first budgeting app workspace.

## Workspace layout

```txt
.
├─ apps/
│  ├─ web/    # TanStack Start app, Zero client/server, Drizzle schema and migrations
│  └─ eve/    # Eve finance assistant runtime
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

### Synthetic test data

Run `just seed` against a running, migrated local database (uses `apps/web/.env`,
with an already-exported `DATABASE_URL` taking precedence). It also works in
orbs after `amp orb services ensure` and `pnpm db:migrate`. No bank credentials,
private dump, AI service, or running web server are needed.

| Email | Password |
| --- | --- |
| `anna@example.test` | `12345678` |
| `bob@example.test` | `12345678` |

Each user has an isolated personal household, the standard chart of accounts,
manual checking and savings accounts, opening balances, and fixed synthetic DKK
history from April through September 2026. Scenarios include salary, rent, varied
groceries, utilities, restaurants, refunds, reimbursements, split purchases,
matched savings transfers, and uncategorized transactions needing review.
Amounts use the application's scale-4 integer representation and every ledger
entry balances. No real bank connections, sessions, or fake AI chat histories
are created; users sign in normally and can start new chats.

The source of truth is `apps/web/scripts/seed-data.json`. All IDs, dates,
timestamps, amounts, chart definitions, and test password hashes are fixed in
that file; the loader does not generate random values or use today's date.
Fresh databases seeded from the same fixture get identical application rows.
Edit the JSON to change the scenarios, keeping references and postings balanced,
then run `pnpm --filter @penge/web test tests/unit/seed.test.mjs`.

Seeding is atomic and additive: existing demo users (including changed passwords
and edited transactions) and unrelated data are left untouched on reruns.
Existing databases are not migrated to revised fixtures by `just seed`; use a
fresh disposable database (or the destructive `just db-reset` locally) to load
the exact fixture state. Date-filtered views may need April–September 2026
selected because fixture dates intentionally do not advance with the clock.
The command rejects remote database hosts and `NODE_ENV=production`; these
public credentials must only be used in disposable development databases.
`just db-reset` **deletes local database data** and now seeds synthetic data by
default, so `just setup`/`just init` no longer need a private dump. The explicit
`seed-capture`/`seed-restore` recipes remain available for private snapshots.

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
