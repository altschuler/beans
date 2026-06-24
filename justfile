set dotenv-load

_default:
  just --list

setup:
  pnpm install
  just db-up
  pnpm db:migrate
  pnpm zero:generate

dev:
  just db-up
  pnpm db:migrate
  pnpm dev

dev-web:
  just dev

dev-flue:
  pnpm dev:flue

db-up:
  just wait-db

db-down:
  docker compose down

db-reset:
  docker compose down -v
  just db-up
  pnpm db:migrate
  rm -rf apps/web/.zero-cache apps/web/zero.db apps/web/zero.db-shm apps/web/zero.db-wal apps/web/zero.db-wal2

wait-db:
  @docker compose up -d --wait --wait-timeout 120 || (docker compose ps -a; docker compose logs --tail=120 postgres; echo 'Postgres did not become healthy within 120 seconds' >&2; exit 1)

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
