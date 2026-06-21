# Testing

This document is the source of truth for how tests should be written in Penge.

## Purpose

Tests should help us change the code with confidence. They should be easy to read, focused on meaningful behavior, and cheap to maintain.

The goal is not to maximize test count. The goal is to cover the behavior that matters.

## Core Rules

### Test behavior, not implementation

This is the most important rule.

Prefer assertions about:

- returned results
- rendered UI
- persisted state changes
- meaningful side effects
- allowed or blocked outcomes

Avoid assertions about:

- which helper called which helper
- exact internal argument plumbing when that is not the behavior under test
- ORM or SDK call choreography
- framework wiring that only restates the code
- exporting functions solely to make them testable

When a full end-to-end assertion is not practical, assert the closest meaningful boundary. For server-function and query tests, that usually means asserting behavior through the shared data-source client seams or the returned result, not through low-level internal implementation details.

Use the cheapest meaningful boundary for the behavior under test. Heavy rendering through child components, providers, routes, or dialogs is useful when the integration itself is the behavior, but avoid it when the parent only owns a small public contract with that child. In those cases, assert the boundary contract narrowly and leave the heavy child behavior to the child's own tests.

Keep these boundary assertions limited to stable public contract fields that the caller owns. Do not assert every derived prop, internal dialog label, generated description, CSS class, or child render detail from the caller test. Test dialog internals in the dialog's own test file, preferably by rendering the real dialog and asserting visible behavior.

If a behavior is genuinely impractical to test in a meaningful way, flag that explicitly and do not write a weak test just for the sake of having one. Every test must earn its place by protecting something valuable.

Do not export functions solely for use in tests. If a test only becomes possible by exposing an internal helper that production code would not otherwise need, that is usually a sign that the test is targeting implementation details instead of behavior.

### Prefer quality over quantity

Keep tests succinct and high-signal.

When functionality is removed, remove tests that existed solely for that functionality. Do not rewrite those tests just to assert that the removed behavior is now absent.

Prefer a small number of meaningful tests over many tiny tests that each prove almost nothing. A test should justify its existence by protecting behavior we actually care about.

Avoid:

- tiny tests that only check constants or trivial object shapes
- splitting one behavior across many low-value tests
- duplicating nearby tests with minor wording changes but no added coverage value

## DO / DON'T

### DO

- DO test authorization through the observable result: allowed access, filtered data, or a forbidden outcome.
- DO test Zero queries and mutators with authenticated context and team-membership boundaries.
- DO test server-side domain commands through returned results and persisted rows when persistence is the behavior.
- DO prefer pure model tests for ledger, accounting, and view-model calculations before reaching for component tests.
- DO add Drizzle schema and Zero schema exposure tests when changing tables or `drizzle-zero.config.ts`.
- DO mock external providers, AI/model calls, and browser-only APIs at the boundary, then assert the app outcome.
- DO use realistic, minimal test data that makes the scenario obvious to the reader.

### DON'T

- DON'T test that CSS classes are applied unless it has functional/behavioral consequences
- DON'T test Drizzle clause structure, SQL-builder chaining, or SDK call choreography unless that structure itself is the behavior being implemented.
- DON'T add tests whose only value is increasing the test count.
- DON'T add a slew of tiny tests that restate constants, pass-through wrappers, or simple mappings with no meaningful business rule behind them.
- DON'T hide business behavior inside magical fixtures or global setup.
- DON'T export internal helpers only so tests can call them directly.

## UI Component Testing Preference

When testing components that use our shared `@/components/ui` primitives, prefer rendering with the real components and real behavior.

- Use minimal mocking only when a browser API or external boundary makes the test impractical.
- Do not fully mock `@/components/ui` by default; this can hide integration and accessibility regressions from Radix/shadcn behavior.
- If a mock is unavoidable, keep it narrowly scoped and document why it is needed in the test file.

## Shared Test Support Direction

Use shared helpers instead of repeating setup noise:

- `tests/helpers/db.ts` for database reset, migration, and shutdown helpers.
- `tests/helpers/seed.ts` and `tests/fixtures/users.ts` for test users.
- `tests/helpers/auth.ts` for creating Better Auth users in Vitest tests.
- `tests/helpers/zero.ts` for Zero context setup.
- `tests/helpers/assertions.ts` for shared Vitest assertions.
- `e2e/helpers/auth.ts` and `e2e/helpers/assertions.ts` for Playwright flows.

## Shared Mock Boundaries

Mock external providers and browser-only boundaries when needed. Keep app/domain behavior visible through returned results, persisted state, rendered UI, or Zero query/mutator seams.

## Builders And Scenarios

Builders should provide minimal valid defaults with cheap shallow overrides.

Scenarios should stay thin and readable. They should compose builders to describe a meaningful state, not become a second hidden implementation layer.

## Running Tests

```bash
just test-unit
just test-e2e
just check
```

Focused Vitest runs can use `pnpm test path/to/file.test.ts`.
Focused Playwright runs can use `pnpm test:e2e path/to/file.spec.ts`.

