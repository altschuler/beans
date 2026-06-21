# Transactions Page Cleanup Design

## Goal

Clean up `/transactions` so the breadcrumb carries the page context, the table is not boxed in a card, and global actions live in a compact action bar.

## Chosen layout

Use the approved “minimal divider bar” direction:

- Remove the page-level `Penge` label, `Transactions` heading, and descriptive subtitle for the default transactions view.
- Keep non-default dashboard headings where they still provide context, such as categories and bank-account transaction pages.
- Render a flat action bar above the transactions table for `view="transactions"` only.
- Put the needs-review count on the left.
- Put AI categorize, sync all accounts, and a three-dots more menu on the right.
- Move the existing clear-categorizations action into the more menu and keep the existing confirmation dialog.
- Remove the card wrapper, card title, and card subtitle around the default transactions table.

## Components

`src/components/ledger/ledger-dashboard.tsx` owns the layout change because it already switches between transactions, categories, and bank-account transaction views. It should reuse existing shadcn-style project components: `Button`, `DropdownMenu`, and `Dialog`. There is no dedicated toolbar/action-bar component installed in this checkout.

`src/components/transaction-table/transaction-table.tsx` should remain responsible only for rendering the table. Its existing table border is acceptable; the requested removed “box” is the dashboard card around the table.

## Testing

Update the existing server-rendered `LedgerDashboard` unit tests to assert that the default transactions view no longer renders the old page header or transactions card header, still renders the review count and actions, and exposes clear categorizations via the more menu path.
