# Categories Page Cleanup Design

## Goal

Clean up `/app/categories` in the same spirit as the cleaned-up transactions page: let the shell breadcrumb carry page context, remove redundant page/card chrome, and keep the page visually simple.

Also bring ledger account detail pages into the breadcrumb pattern so they do not need an in-page back link.

## Categories page

Use a minimal flat layout for `LedgerDashboard` when `view="categories"`:

- Remove the in-page `Penge` label, `Categories` heading, and descriptive subtitle.
- Remove the category `Card`, `CardHeader`, `CardTitle`, and `CardDescription` wrapper.
- Add a compact divider bar above the category list, similar to the transactions action bar, containing only a useful count such as `8 categories`.
- Do not show secondary explanatory text such as “Balances from ledger movements”.
- Keep existing category grouping, category account links, and displayed balances unchanged.
- Do not add actions, filters, or sorting.

The existing transactions view remains unchanged by this cleanup.

## Account detail breadcrumbs

Update the shell breadcrumb logic for `/app/accounts/$accountId`:

- Resolve the account id from Zero ledger accounts.
- Render a breadcrumb path with `Categories` as the parent context and the account name as the current page, e.g. `Categories / Take-away`.
- If the account is missing from synced data, use `Account` as the page fallback.

Update `LedgerAccountDetail`:

- Remove the in-page `Back to dashboard` link from both the normal detail and not-found states.
- Keep the account title, group label, current balance, period controls, chart, and activity cards unchanged.

## Testing

Update existing unit tests:

- `tests/unit/ledger-dashboard.test.ts`: assert categories render without the old page heading/card copy, include the simple category count bar, keep category links/balances, and do not show transaction actions.
- `tests/unit/shell.test.ts`: assert `/app/accounts/$accountId` renders a categories/account breadcrumb and resolves the account name.
- `tests/unit/ledger-account-detail.test.ts`: assert the back link is absent in normal and not-found states while existing content remains.
