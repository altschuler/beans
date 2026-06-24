# Penge web app

TanStack Start web application for Penge. This package owns the browser UI, Better Auth, Zero queries/mutators, Drizzle schema, and web-facing server functions.

Most commands should be run from the workspace root through `just` or pnpm filters. See the root `README.md` for full setup.

## Local files

```bash
cp apps/web/.env.example apps/web/.env
```

The dev app uses a self-signed localhost certificate generated in `apps/web/.cert/`. Your browser will ask you to accept the certificate the first time.

## Package commands

From the workspace root:

```bash
pnpm --filter @penge/web dev
pnpm --filter @penge/web typecheck
pnpm --filter @penge/web test
pnpm --filter @penge/web build
```

## Tests

Vitest helpers live in `apps/web/tests/helpers`. Playwright helpers live in `apps/web/e2e/helpers`. Tests should read as scenarios and use shared seed/auth/assertion helpers instead of repeating setup noise.

## Zero

The Zero schema is generated from Drizzle:

```bash
just zero-generate
```

Do not hand-edit `apps/web/src/zero/schema.ts`.
