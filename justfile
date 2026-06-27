set dotenv-load

_default:
  just --list

setup:
  pnpm install
  just db-reset
  pnpm zero:generate

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

dev:
  just db-up
  pnpm db:migrate
  pnpm --parallel --stream --filter @penge/web --filter @penge/flue dev

dev-web:
  just db-up
  pnpm db:migrate
  pnpm dev:web

dev-flue:
  pnpm dev:flue

db-up:
  just wait-db

db-down:
  docker compose down

nuke:
  docker compose down -v --remove-orphans
  rm -rf apps/web/.zero-cache apps/web/zero.db apps/web/zero.db-shm apps/web/zero.db-wal apps/web/zero.db-wal2 apps/flue/.flue-vite

nuke-and-reset:
  just db-reset

wait-db:
  @docker compose up -d --wait --wait-timeout 120 || (docker compose ps -a; docker compose logs --tail=120 postgres; echo 'Postgres did not become healthy within 120 seconds' >&2; exit 1)

seed-capture:
  #!/usr/bin/env bash
  set -euo pipefail
  mkdir -p .local/dev-seed
  docker compose up -d --wait --wait-timeout 120
  docker compose exec -T postgres pg_dump -U postgres -d penge -Fc --data-only \
    --table='"user"' \
    --table=account \
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

db-reset:
  docker compose down -v --remove-orphans
  just wait-db
  pnpm db:migrate
  just seed-restore
  pnpm db:migrate

db-generate:
  pnpm db:generate

db-migrate:
  just db-up
  pnpm db:migrate

zero-generate:
  pnpm zero:generate

test:
  pnpm test

test-unit:
  pnpm test

test-e2e:
  pnpm test:e2e

lint:
  pnpm lint

check:
  pnpm check
