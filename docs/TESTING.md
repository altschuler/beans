# Testing

This document is the source of truth for how tests should be written in Penge.

## Purpose

Tests should give us confidence to change code. Prefer a few readable, high-signal tests over many low-value ones. Every test should protect behavior we care about.

## Core Rules

### Test behavior, not implementation

Prefer assertions about observable behavior:

- returned results
- rendered UI
- persisted state changes
- meaningful side effects
- allowed or blocked outcomes

Avoid assertions about implementation details:

- helper-to-helper calls
- internal argument plumbing
- ORM, SDK, SQL-builder, or framework choreography
- exact CSS classes unless they have behavioral consequences
- functions exported only for tests

If a full end-to-end assertion is impractical, test the closest meaningful boundary. For server functions and queries, that is usually the returned result, persisted state, or shared data-source/client seam.

Use heavy rendering, providers, routes, dialogs, and child components only when that integration is the behavior. Otherwise assert the parent-owned public contract and test the child in its own file.

If meaningful coverage is not practical, say so explicitly instead of adding a weak test.

### Keep tests high-signal

- Remove tests for removed functionality.
- Do not rewrite old tests only to assert removed behavior is absent.
- Avoid tests that only check constants, trivial shapes, pass-through wrappers, or simple mappings without business rules.
- Avoid splitting one behavior across many tiny tests.
- Keep test data realistic, minimal, and obvious.
- Do not hide business behavior inside magical fixtures or global setup.

## Project Guidance

- Test authorization through observable outcomes: allowed access, filtered data, or forbidden results.
- Test Zero queries and mutators with authenticated context and team-membership boundaries.
- Test server-side domain commands through returned results and persisted rows when persistence is the behavior.
- Prefer pure model tests for ledger, accounting, and view-model calculations before component tests.
- Add Drizzle schema and Zero schema exposure tests when changing tables or `apps/web/drizzle-zero.config.ts`.
- Mock external providers, AI/model calls, and browser-only APIs at the boundary, then assert the app outcome.

## UI Component Tests

When components use shared `@/components/ui` primitives, prefer rendering the real components and behavior.

- Do not fully mock `@/components/ui` by default; that can hide Radix/shadcn integration and accessibility regressions.
- Mock only browser APIs or external boundaries that make the test impractical.
- If a mock is unavoidable, keep it narrow and document why in the test file.

## Shared Test Support

Use shared helpers instead of repeating setup noise:

- `apps/web/tests/helpers/db.ts` for database reset, migration, and shutdown helpers.
- `apps/web/tests/helpers/seed.ts` and `apps/web/tests/fixtures/users.ts` for test users.
- `apps/web/tests/helpers/auth.ts` for creating Better Auth users in Vitest tests.
- `apps/web/tests/helpers/zero.ts` for Zero context setup.
- `apps/web/tests/helpers/assertions.ts` for shared Vitest assertions.
- `apps/web/e2e/helpers/auth.ts` and `apps/web/e2e/helpers/assertions.ts` for Playwright flows.

## Builders And Scenarios

Builders should provide minimal valid defaults with cheap shallow overrides.

Scenarios should stay thin and readable. They should compose builders to describe meaningful state, not become a second hidden implementation layer.

## Running Tests

```bash
just test-unit
just test-e2e
just check
```

Focused Vitest runs from the workspace root can use `pnpm --filter @penge/web test path/to/file.test.ts`, with paths relative to `apps/web`.
Focused Playwright runs can use `pnpm --filter @penge/web test:e2e path/to/file.spec.ts`, with paths relative to `apps/web`.
