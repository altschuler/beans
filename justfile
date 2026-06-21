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

db-up:
  just wait-db

db-down:
  docker compose down

db-reset:
  docker compose down -v
  just db-up
  pnpm db:migrate
  rm -rf .zero-cache zero.db zero.db-shm zero.db-wal zero.db-wal2

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
