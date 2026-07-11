# Reference docs

These docs describe Penge's current product and system behavior. They synthesize implemented specs and current code; historical specs remain design history.

## Current reference map

- [Product principles](./product-principles.md) — immutable bank evidence, replaceable ledger interpretation, and team-scoped data.
- [Accounting and ledger model](./accounting-and-ledger.md) — transactions, postings, reconciliation, balances, and account history.
- [Money representation and display](./money.md) — scale-4 integer amounts, parsing, arithmetic, and display.
- [Transaction review and categorization](./transaction-categorization.md) — review UI, categories, splits, transfers, confirmation, and reset behavior.
- [AI categorization](./ai-categorization.md) — Eve task orchestration, workflow visibility, trace, confidence, and guarded writes.
- [Team data assistant](./team-data-assistant.md) — Eve chat, scoped reads, durable history, approval-gated writes, and recovery.
- [Categories](./categories.md) — groups, editable categories, locked accounts, balances, and deletion rules.
- [Bank accounts and sync](./banking.md) — GoCardless linking, manual data, sync state, and bank evidence.
- [App shell and navigation](./app-shell.md) — navigation, layouts, page actions, and Ask Penge.

## Deliberately not current

`docs/specs/2026-06-20-refresh-safe-long-running-tasks-design.md` is not implemented as a general pattern. Bank sync still awaits server-function work. AI categorization uses Eve task sessions with team-level `agent_workflow_runs` visibility instead of row-level processing claims.
