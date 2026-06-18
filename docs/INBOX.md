# Inbox

- 2026-06-18: Ledger dashboard categorization work showed that `pnpm test`, focused tests, typecheck, and lint can all pass while `pnpm build` fails TanStack Start import protection for client-reachable dynamic imports of `*.server.*` modules. Consider adding `pnpm build` to plans/checks that introduce server-only modules used near client/shared boundaries.
- 2026-06-18: `AGENTS.md` references `docs/DATABASES.md`, `docs/TESTING.md`, `docs/CODESTYLE.md`, and `docs/SERVER.md`, but this checkout currently has `docs/DATABASE.md` and no testing/code-style/server docs. Future agents will hit missing-doc reads unless the references or docs are reconciled.
- 2026-06-18: Envelope ledger foundation creates ledger rows for new bank syncs, but historical bank transactions that already exist before the migration need an explicit backfill/reconciliation strategy. This may belong with the planned reconciliation-problem reporting follow-up.
- 2026-06-18: Ledger DB constraints currently rely on repository code for same-team integrity between ledger transactions, bank transactions, and movement accounts. Consider composite keys/checks or validation when manual ledger editing is introduced.
