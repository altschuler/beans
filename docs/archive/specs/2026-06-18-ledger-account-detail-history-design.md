# Ledger Account Detail History Design

## Status

Draft approved in conversation on 2026-06-18.

## Summary

Clicking a ledger account on the dashboard opens a dedicated account detail page. The page shows the account's current ledger balance, a chart whose meaning depends on the account kind, and the transactions or movements that explain that chart.

The feature must avoid mixing two separate concepts:

- current ledger/envelope balance: how much is available, overspent, or allocated right now
- historical activity: spending, bank-account movement, or envelope money added/removed over time

A generic "account development" graph is misleading for envelope accounts because budget reallocations can change available balance without representing actual spending. The page therefore uses explicit account-specific chart labels and data rules.

## Route and navigation

Route: `/app/accounts/:accountId`

The existing dashboard account rows become links to this route. The account detail page includes a back link to `/app`.

If the account id does not exist in the currently synced Zero data, the page shows a friendly account-not-found state rather than throwing.

## Responsive layout

The account detail page uses the selected split-dashboard layout:

- desktop and wider screens: chart and relevant transactions/activity side by side
- smaller screens: chart first, transactions/activity below, similar to the chart-first layout

The header shows:

- account name
- account group
- current derived ledger balance
- a short subtitle explaining what the chart includes

## Account-specific chart semantics

The page chooses the chart mode from account kind.

### Spending/category ledger accounts

Spending/category accounts show actual bank spending history.

Rules:

- Include only ledger movements from ledger transactions linked to imported bank transactions.
- Include only movements involving the selected ledger account.
- Use the linked bank transaction date, preferring booking date over value date over ledger transaction date.
- Aggregate by week or month based on the selected toggle.
- Show actual spend as positive bars.
- Ignore budget reallocations, manual envelope moves, and other non-bank-import ledger movements.

This answers questions like "how much did I spend on take-away this week/month?" without being distorted by later budget moves.

### Linked bank ledger accounts

Bank ledger accounts linked to real bank accounts show bank-account movement history.

Rules:

- Use imported bank transactions for the linked real bank account.
- Render a line chart of cumulative imported movement over time.
- Label the chart as imported-history-based. It should not claim to be full lifetime balance unless opening balance/current balance data is added later.
- The activity list shows imported bank transactions for that real bank account.

This supports savings accounts that exist as actual bank accounts.

### Savings/envelope ledger accounts

Savings/envelope accounts that are not linked bank accounts show money added/removed over time.

Rules:

- Use ledger movements involving the selected account.
- Include both bank-import and non-bank-import ledger movements, because envelope funding/reallocation is the point for this account kind.
- Aggregate by week or month based on the selected toggle.
- Show money added as positive bars and money removed as negative bars.
- Label this as envelope activity, not actual bank spending.

This supports savings goals/envelopes that may conceptually correspond to a bank savings account but are not assumed to have the same balance.

## Period toggle

The chart supports two period granularities:

- Weekly
- Monthly

The default can be monthly for broad history, unless existing UI conventions suggest otherwise during implementation.

Weekly grouping should be stable and predictable. Use ISO-style week starts on Monday if a helper is added.

Monthly grouping should use calendar months.

## Transactions and activity list

The right-hand/below chart list uses the same semantics as the selected chart mode:

- spending/category account: bank-import transactions categorized to the selected account
- linked bank account: imported bank transactions for the linked real bank account
- savings/envelope account: ledger movements involving the selected envelope account

Rows show, as available:

- date
- description
- amount and currency
- source context, such as bank account name or ledger transaction source

## Chart implementation

Use a lightweight custom SVG chart for the first version rather than adding a chart dependency.

The chart should support:

- bar chart for period totals
- positive/negative bars for envelope added/removed activity
- line chart for bank imported movement history
- empty state text when there is no relevant history

Visual precision can be simple in the first version. Clear labels and correct aggregation matter more than chart polish.

## Error and empty states

- Unknown account: show a friendly account-not-found state.
- No chart data: keep the page visible with current balance and show a mode-specific empty state.
- Ambiguous account kind: fall back to envelope activity with explicit labeling, unless implementation discovers a clearer existing account type convention.

## Out of scope

This iteration does not include:

- account creation/editing
- explicit linking between a ledger savings envelope and a bank savings account
- opening balance setup
- full real bank balance reconstruction from external balance endpoints
- chart library adoption
- custom date ranges beyond weekly/monthly aggregation
- budget allocation workflow changes

## Testing plan

Add focused tests for:

- dashboard account rows link to `/app/accounts/:accountId`
- account detail model resolves account, group, current balance, and mode
- weekly and monthly spending aggregation ignores non-bank-import ledger movements
- linked bank account line data uses imported transactions for the linked bank account
- savings/envelope aggregation shows money added and removed with signs
- account-not-found and empty states render safely
- account detail component renders the selected mode with the weekly/monthly toggle

Run focused unit tests and typecheck after implementation.
