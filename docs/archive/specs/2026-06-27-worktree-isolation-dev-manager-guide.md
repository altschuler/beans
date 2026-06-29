# Worktree isolation dev manager guide

Date: 2026-06-27

## Purpose

Adopt the reusable toolbox dev manager from `/home/simon/dev/see-also/agents/toolbox/dev` so each Penge checkout and worktree has isolated local development infrastructure:

- project-local git worktree under `.worktrees/<branch-slug>`
- per-checkout Docker Compose project name
- per-checkout Postgres container, network, and volume
- per-checkout web, Flue, Zero, and Postgres host ports
- generated ignored env files
- safe worktree removal that cleans Docker resources
- repeatable restore from a meaningful local seed database snapshot

This is a local-development-only guide. Do not commit generated env files, seed dumps, Docker volumes, or worktree contents.

## Source template

Use the copy-in template at:

```txt
/home/simon/dev/see-also/agents/toolbox/dev
```

Relevant files:

```txt
toolbox/dev/dev.mjs                  # reusable CLI script; copy into Penge
toolbox/dev/dev.config.example.mjs   # generic config reference
toolbox/dev/Justfile.snippet         # Just recipes to adapt
toolbox/dev/README.md                # template documentation
```

Do not copy `dev.test.mjs`; it tests the toolbox template, not this project.

## Goals

1. Replace fixed local ports with generated per-checkout ports.
2. Use `COMPOSE_PROJECT_NAME` so sibling worktrees do not share Docker resources.
3. Make worktree creation and removal go through project commands, not raw `git worktree add/remove`.
4. Capture a local, meaningful seed snapshot from the current database before deleting old dev volumes.
5. Restore each checkout/worktree from the seed after migrations.
6. Preserve manually managed secrets in app env files when refreshing generated env values.

## Non-goals

- Preserve existing Docker volumes or unnamed Compose project data after the seed is captured.
- Commit seed data to the repository.
- Support production deployment configuration.
- Replace Better Auth, Zero, or Flue runtime architecture.
- Make agents create worktrees without explicit user approval.

## Current Penge state

Penge currently has hardcoded local ports and paths in several places:

- `docker-compose.yml`: Postgres exposes `5432:5432`.
- `apps/web/package.json`: Vite uses `3100`; Zero cache defaults to `4848`.
- `apps/flue/package.json`: Flue dev uses `3101`.
- `apps/web/.env.example`: URLs reference `3100`, `3101`, `4848`, and `5432`.
- `apps/flue/.env.example`: references `3101` and `5432`.
- `apps/web/playwright.config.ts`: base URL and web server URL reference `https://localhost:3100`.
- Some runtime fallback constants still default to the same ports; these are acceptable as defaults, but env-driven dev should supply the generated values.

The existing `justfile` uses `set dotenv-load`, which means a generated root `.env` can supply Docker Compose and Just recipe environment values.

## Generated local files

Add `.worktrees/` to ignore rules if it is not already ignored:

```gitignore
.worktrees/
```

The repository already ignores broad `.env` / `.env.*` patterns and `.local/`; those patterns also cover app-local env files such as `apps/web/.env` and `apps/flue/.env`. Verify `.worktrees/` is ignored before enabling worktree creation.

Use this local seed path:

```txt
.local/dev-seed/penge-data.dump
```

The seed path is local-only and must stay ignored.

## Files to add

### `scripts/dev.mjs`

Copy from the toolbox:

```bash
mkdir -p scripts
cp /home/simon/dev/see-also/agents/toolbox/dev/dev.mjs scripts/dev.mjs
chmod +x scripts/dev.mjs
```

### `dev.config.mjs`

Create a Penge-specific config at the repo root. The exact values can evolve, but the first version should manage these port ranges:

```js
export default {
  projectName: 'penge',
  worktreeDir: '.worktrees',
  envFile: '.env',

  ports: {
    PORT: [3100, 3199],
    FLUE_PORT: [3200, 3299],
    POSTGRES_PORT: [5500, 5599],
    ZERO_PORT: [4848, 4999],
    ZERO_CHANGE_STREAMER_PORT: [5000, 5099],
  },

  env: {
    COMPOSE_PROJECT_NAME: ({projectName, slug}) => `${projectName}_${slug.replaceAll('-', '_')}`,
    DATABASE_URL: ({env}) => `postgres://postgres:postgres@localhost:${env.POSTGRES_PORT}/penge`,
    TEST_DATABASE_URL: ({env}) => `postgres://postgres:postgres@localhost:${env.POSTGRES_PORT}/penge_test`,
    ZERO_UPSTREAM_DB: ({env}) => `postgres://postgres:postgres@localhost:${env.POSTGRES_PORT}/penge`,
    ZERO_QUERY_URL: ({env}) => `https://localhost:${env.PORT}/api/zero/query`,
    ZERO_MUTATE_URL: ({env}) => `https://localhost:${env.PORT}/api/zero/mutate`,
    ZERO_QUERY_FORWARD_COOKIES: 'true',
    ZERO_MUTATE_FORWARD_COOKIES: 'true',
    ZERO_LOG_LEVEL: 'warn',
    VITE_PUBLIC_ZERO_CACHE_URL: ({env}) => `http://localhost:${env.ZERO_PORT}`,
    BETTER_AUTH_URL: ({env}) => `https://localhost:${env.PORT}`,
    BETTER_AUTH_TRUSTED_ORIGINS: 'https://localhost:*',
    VITE_PUBLIC_APP_URL: ({env}) => `https://localhost:${env.PORT}`,
    PENGE_FLUE_BASE_URL: ({env}) => `http://localhost:${env.FLUE_PORT}`,
    PENGE_FLUE_INTERNAL_TOKEN: 'change-me',
  },

  envFiles: [
    {path: '.env', source: 'managed-root'},
    {
      path: 'apps/web/.env',
      sync: [
        'DATABASE_URL',
        'TEST_DATABASE_URL',
        'ZERO_UPSTREAM_DB',
        'ZERO_QUERY_URL',
        'ZERO_MUTATE_URL',
        'ZERO_QUERY_FORWARD_COOKIES',
        'ZERO_MUTATE_FORWARD_COOKIES',
        'ZERO_LOG_LEVEL',
        'ZERO_PORT',
        'ZERO_CHANGE_STREAMER_PORT',
        'VITE_PUBLIC_ZERO_CACHE_URL',
        'BETTER_AUTH_URL',
        'BETTER_AUTH_TRUSTED_ORIGINS',
        'VITE_PUBLIC_APP_URL',
        'PENGE_FLUE_BASE_URL',
        'PENGE_FLUE_INTERNAL_TOKEN',
      ],
      remove: ['PORT', 'FLUE_PORT', 'POSTGRES_PORT', 'COMPOSE_PROJECT_NAME'],
      defaults: {
        BETTER_AUTH_SECRET: {randomBase64Url: 32},
        GOCARDLESS_SECRET_ID: 'replace-with-gocardless-bank-account-data-secret-id',
        GOCARDLESS_SECRET_KEY: 'replace-with-gocardless-bank-account-data-secret-key',
      },
      databaseUrl: {
        key: 'DATABASE_URL',
        portKey: 'POSTGRES_PORT',
        databaseName: 'penge',
      },
    },
    {
      path: 'apps/flue/.env',
      sync: ['DATABASE_URL', 'FLUE_PORT', 'PENGE_FLUE_INTERNAL_TOKEN'],
      remove: ['PORT', 'POSTGRES_PORT', 'COMPOSE_PROJECT_NAME'],
      defaults: {
        OPENAI_API_KEY: '',
      },
      databaseUrl: {
        key: 'DATABASE_URL',
        portKey: 'POSTGRES_PORT',
        databaseName: 'penge',
      },
    },
  ],

  hooks: {
    afterInit: ['pnpm install', 'just db-reset'],
    afterCreate: ['pnpm install', 'just db-reset'],
    beforeRemove: ['docker compose down -v --remove-orphans'],
  },
}
```

Notes:

- `FLUE_PORT` is intentionally separate from `PORT`; `apps/flue/package.json` can map it to the Flue CLI `--port` flag.
- `ZERO_CHANGE_STREAMER_PORT` is explicit because Zero otherwise defaults the internal change-streamer to `ZERO_PORT + 1`, which can collide across sibling worktrees. `zero-cache-dev --help` for the current Zero version confirms both `--change-streamer-port` and `ZERO_CHANGE_STREAMER_PORT` are supported.
- Unknown keys in existing app env files are preserved by `dev.mjs`, so local secrets can survive refreshes.
- `PENGE_FLUE_INTERNAL_TOKEN` must be defined once in root managed env and synced to both app env files. Do not define independent app-local defaults for it, or web and Flue can silently drift.
- If app-local tooling expects `PORT` in `apps/flue/.env`, either sync `PORT` there from `FLUE_PORT` with a config enhancement or use `FLUE_PORT` directly in the Flue script.

## Docker Compose changes

Change Postgres host port from a fixed value to an env-driven value:

```yaml
services:
  postgres:
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
```

Docker Compose automatically reads root `.env` from the compose working directory. `COMPOSE_PROJECT_NAME` in that root `.env` will isolate containers, networks, and volumes by checkout.

Because existing dev data does not need to be preserved after the seed is captured, it is acceptable to run:

```bash
docker compose down -v --remove-orphans
```

as part of rollout.

## Package script changes

### Web app

Make web dev scripts read generated env values:

```json
{
  "scripts": {
    "dev:app": "dotenv -e .env -- sh -c 'vite dev --host 0.0.0.0 --port ${PORT:-3100}'",
    "dev:zero": "NODE_TLS_REJECT_UNAUTHORIZED=0 dotenv -e .env -- sh -c 'mkdir -p .zero-cache && ZERO_LOG_LEVEL=${ZERO_LOG_LEVEL:-warn} ZERO_REPLICA_FILE=${ZERO_REPLICA_FILE:-.zero-cache/zero.db} exec zero-cache-dev --port ${ZERO_PORT:-4848} --change-streamer-port ${ZERO_CHANGE_STREAMER_PORT:-4849}'"
  }
}
```

`dotenv-cli` already exists in `apps/web` dev dependencies.

### Flue sidecar

Make Flue read generated env values. One option is to add `dotenv-cli` where needed and use:

```json
{
  "scripts": {
    "dev": "dotenv -e .env -- sh -c 'flue dev --target node --port ${FLUE_PORT:-3101}'"
  }
}
```

Alternative: keep `PORT` in `apps/flue/.env` and use `${PORT:-3101}`. Prefer `FLUE_PORT` in the root generated env to avoid ambiguity with the web app port.

## Playwright changes

Update `apps/web/playwright.config.ts` to derive URLs from env. This is an illustrative diff to merge into the existing file, not a full-file replacement; keep the current `testDir`, timeouts, reporter, retries, and `projects` settings.

```ts
const appUrl = process.env.VITE_PUBLIC_APP_URL ?? `https://localhost:${process.env.PORT ?? '3100'}`

export default defineConfig({
  use: {
    baseURL: appUrl,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'just dev',
    url: appUrl,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

## Just recipes

Add toolbox recipes:

```just
# Generate or refresh ignored per-checkout env files and run configured hooks.
init:
  node scripts/dev.mjs init

# Create a new isolated project-local worktree for a branch.
worktree-create branch:
  node scripts/dev.mjs create "{{ branch }}"

# Remove an isolated worktree and run configured cleanup hooks first.
worktree-remove branch *args:
  node scripts/dev.mjs remove "{{ branch }}" {{ args }}

# List slugs for active isolated worktrees managed under .worktrees/.
worktree-list:
  node scripts/dev.mjs list
```

Add seed and reset recipes. Use shebang recipes (or equivalent scripts) so path variables and redirection happen in one shell.

Important rollout constraint: the first seed capture must run before `just init` creates the generated root `.env`. At that point `COMPOSE_PROJECT_NAME` is unset, so `docker compose` targets the original default project for this directory, which is where the existing meaningful dev data lives. After root `.env` exists, `seed-capture` targets the checkout's generated isolated Compose project instead. If the old default project must be captured later, intentionally run the command with the generated `.env` out of scope or with the correct default Compose project selected.

```just
seed-capture:
  #!/usr/bin/env bash
  set -euo pipefail
  mkdir -p .local/dev-seed
  docker compose up -d --wait --wait-timeout 120
  docker compose exec -T postgres pg_dump -U postgres -d penge -Fc --data-only \
    --table='"user"' \
    --table=teams \
    --table=team_members \
    --table=bank_connections \
    --table=bank_accounts \
    --table=bank_transactions \
    --table=ledger_account_groups \
    --table=ledger_accounts \
    --table=ledger_transactions \
    --table=ledger_postings \
    > .local/dev-seed/penge-data.dump

seed-restore:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .local/dev-seed/penge-data.dump ]]; then
    seed_path=.local/dev-seed/penge-data.dump
  elif [[ -f ../../.local/dev-seed/penge-data.dump ]]; then
    seed_path=../../.local/dev-seed/penge-data.dump
  else
    echo 'Missing local seed dump. Run `just seed-capture` in the main checkout before `just init` or `just worktree-create`.' >&2
    exit 1
  fi

  docker compose exec -T postgres pg_restore \
    -U postgres \
    -d penge \
    --data-only \
    --disable-triggers \
    --single-transaction \
    --no-owner \
    --no-privileges \
    < "$seed_path"
```

`seed-restore` resolves the seed path from either the main checkout or a first-level `.worktrees/<slug>` checkout. The `docker compose exec` command targets the current checkout's Compose project: the generated root `.env` supplies `COMPOSE_PROJECT_NAME` for isolated checkouts, and Compose falls back to the default project only before adoption. `--disable-triggers` avoids FK-order problems when loading data into a freshly migrated schema with live foreign keys; this works because the local Postgres user is the `postgres` superuser.

`db-reset` should become the single command used by `init`, `worktree-create`, and humans:

```just
db-reset:
  docker compose down -v --remove-orphans
  just wait-db
  pnpm db:migrate
  just seed-restore
  pnpm db:migrate
```

Run migrations before restore so tables exist. Run migrations again after restore so a slightly older seed can be brought up to the current schema.

`db-reset` prepares the development database. The current DB-backed unit test helpers create and migrate `TEST_DATABASE_URL` (`penge_test`) on demand via `migrateDatabase()`. If future tests stop doing that, add explicit test database creation/migration to `db-reset` or to a dedicated test setup recipe.

## Seed table policy

Use a whitelist, not a full dump with exclusions.

Include durable, meaningful app state:

```txt
user
teams
team_members
bank_connections
bank_accounts
bank_transactions
ledger_account_groups
ledger_accounts
ledger_transactions
ledger_postings
```

Exclude volatile or security-sensitive state:

```txt
session
verification
account
agent_workflow_runs
any future flue_* runtime tables
Zero cache/replica state
```

Rationale:

- `user` is needed because `teams`, `team_members`, and workflow-visible data reference user ids.
- `session`, `verification`, and `account` are Better Auth operational/credential tables and should not be copied from real local state into every worktree.
- `agent_workflow_runs` describes active/completed app-visible workflow executions, not durable seed data. There are no dedicated `flue_*` tables in the current schema; if Flue runtime tables are added later, keep them out of the seed.
- Zero replica files are cache artifacts and should be recreated per checkout.

## Local login after restore

Because `account` is excluded, restored domain data may not have an associated password login. The implementation should provide one deterministic local dev login path.

Preferred approach:

1. Restore the whitelisted seed including `user` rows.
2. Pick one seeded user as the default dev user, either by configured email or first available user.
3. Run a local-only script after restore to create or replace a Better Auth credential account for that user with known dev credentials.
4. Document the credentials in ignored local docs or in the command output, not in committed seed data if avoidable.

Example committed defaults may be acceptable for local-only development, such as:

```txt
email: dev@example.test
password: password
```

However, the implementation must confirm how Better Auth stores password credentials before writing this script. Do not hand-roll password hashes without verifying Better Auth's expected format.

Fallback if the credential script is deferred:

- Keep the seed restore working.
- Let developers create a fresh local account through `/login`.
- Provide a small admin/dev command later to attach that user to the seeded team.

## Rollout sequence

1. Confirm current working tree state and avoid overwriting unrelated user changes.
2. Add `.worktrees/` to `.gitignore` if missing.
3. Copy `scripts/dev.mjs` from the toolbox.
4. Add `dev.config.mjs`.
5. Make Docker Compose use `${POSTGRES_PORT:-5432}`.
6. Make web, Zero, Flue, and Playwright scripts read generated env values.
7. Add Just recipes for `init`, `worktree-create`, `worktree-list`, `worktree-remove`, `seed-capture`, `seed-restore`, and `db-reset`.
8. Capture seed before deleting old dev volumes and before running `just init` for the first time. This first capture intentionally targets the original/default Compose project because no generated root `.env` exists yet:

   ```bash
   just seed-capture
   ```

9. Reset current checkout with generated env and seed:

   ```bash
   docker compose down -v --remove-orphans
   just init
   ```

10. Verify current checkout:

    ```bash
    just dev-web
    just dev-flue
    just test-unit
    ```

11. Verify worktree isolation:

    ```bash
    just worktree-create verify-worktree-isolation
    cd .worktrees/verify-worktree-isolation
    just dev-web
    just dev-flue
    ```

12. Confirm the main checkout and worktree have different values for:

    ```txt
    COMPOSE_PROJECT_NAME
    PORT
    FLUE_PORT
    POSTGRES_PORT
    ZERO_PORT
    ZERO_CHANGE_STREAMER_PORT
    DATABASE_URL
    VITE_PUBLIC_APP_URL
    PENGE_FLUE_BASE_URL
    ```

13. Remove the disposable worktree through the managed command:

    ```bash
    cd ../..
    just worktree-remove verify-worktree-isolation
    ```

## Agent and contributor guidance

Add guidance to `AGENTS.md` or local development docs:

- Do not run `git worktree add` directly in this repository.
- Use `just worktree-create <branch>` or `node scripts/dev.mjs create <branch>` when the user explicitly asks for a worktree.
- Do not create a worktree without explicit confirmation for that specific worktree.
- Use `just worktree-remove <branch>` or `node scripts/dev.mjs remove <branch>` so Docker containers, networks, and volumes are cleaned up.
- Use `--force` only when the user agrees to discard uncommitted changes in the target worktree.
- Do not commit generated env files, `.worktrees/`, `.local/dev-seed/`, or Docker artifacts.

This preserves the project rule in `docs/PLANS.md`: do not use worktrees unless told to do so.

## Verification checklist

- `git check-ignore -q .worktrees` succeeds.
- `just seed-capture` creates `.local/dev-seed/penge-data.dump`.
- `just init` generates root `.env`, `apps/web/.env`, and `apps/flue/.env`.
- `docker compose ps` shows a Compose project name derived from the current checkout slug.
- `just db-reset` restores the seed into the isolated database.
- `just dev-web` starts on the generated web port.
- `just dev-flue` starts on the generated Flue port.
- Zero cache starts on the generated `ZERO_PORT` and uses the generated change-streamer port.
- `just worktree-create <branch>` creates `.worktrees/<slug>` with distinct ports.
- Main checkout and worktree can run at the same time without port conflicts.
- `just worktree-remove <branch>` removes the worktree and cleans its Docker resources.

## Risks and mitigations

### Existing dev DB is deleted too early

Mitigation: run `just seed-capture` before any `docker compose down -v` during rollout.

### Seed restore cannot authenticate a user

Mitigation: exclude auth credentials from the seed, then implement a verified Better Auth local credential helper or document the temporary manual login/team-attach flow.

### Zero internal port collision

Mitigation: manage both `ZERO_PORT` and `ZERO_CHANGE_STREAMER_PORT` explicitly.

### Generated env overwrites secrets

Mitigation: use `dev.mjs` env file specs that preserve unknown keys and only sync managed keys/default missing values.

### Worktree contents accidentally tracked

Mitigation: require `git check-ignore -q .worktrees` before worktree creation. The toolbox already enforces this.

### Agents bypass managed lifecycle

Mitigation: document in `AGENTS.md` that worktrees must be created/removed via the project commands, not direct git commands.
