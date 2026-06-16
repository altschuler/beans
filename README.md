# Penge

Local-first budgeting app foundation built with TanStack Start, React, shadcn-style UI, Better Auth, Drizzle/Postgres, Zero, Vitest, Playwright, Docker Compose, pnpm, and just.

## Requirements

- Node.js 24+
- pnpm
- Docker
- just

## Setup

```bash
cp .env.example .env
just setup
```

## Development

```bash
just dev
```

App: https://localhost:3000  
Zero cache: http://localhost:4848

The dev app uses a self-signed localhost certificate generated in `.cert/`. Your browser will ask you to accept the certificate the first time.

## Database

```bash
just db-generate
just db-migrate
just db-reset
```

Postgres runs in Docker with `wal_level=logical` so Zero can replicate changes.

## Tests

```bash
just test-unit
just test-e2e
just check
```

Vitest helpers live in `tests/helpers`. Playwright helpers live in `e2e/helpers`. Tests should read as scenarios and use shared seed/auth/assertion helpers instead of repeating setup noise.

## Zero

The Zero schema is generated from Drizzle:

```bash
just zero-generate
```

Do not hand-edit `src/zero/schema.ts`.
