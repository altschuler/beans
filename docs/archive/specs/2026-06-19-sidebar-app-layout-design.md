# Sidebar app layout design

## Goal

Restructure the authenticated application around a shadcn sidebar layout with persistent navigation and main content pages. The sidebar should make team context, app navigation, bank accounts, bank connection management, and the logged-in user visible throughout the protected app.

## Scope

In scope:

- Replace the current protected top-header shell with a shadcn sidebar-based shell.
- Use the shadcn `sidebar-01` block as the base for sidebar structure and components.
- Show the current team name at the top of the sidebar.
- Show the logged-in user at the bottom of the sidebar, with existing sign-out behavior preserved.
- Add primary navigation entries:
  - Home
  - Transactions
  - Categories
- Add a Bank accounts sidebar section that lists the current team's bank accounts.
- Add a bank-account management link in the Bank accounts section, labelled `Manage bank connections` or equivalent.
- Add or restructure pages so each sidebar entry has a clear destination.
- Add bank-account-specific transaction pages showing only transactions for the selected bank account.

Out of scope:

- Adding new category-management CRUD features.
- Adding dashboard widgets to Home.
- Changing the banking sync model or provider integration.
- Changing authorization or Zero query security boundaries.

## Route structure

Authenticated pages remain under `/_protected` and are publicly addressed under `/app`.

Planned routes:

- `/app` — Home placeholder page. It should render a simple empty state such as `Home` and `Nothing here yet`.
- `/app/transactions` — Transactions page. This uses the current ledger transaction review/categorization table.
- `/app/categories` — Categories page. This shows the current category/account balance overview extracted from the existing ledger dashboard.
- `/app/banks` — Manage bank connections page. This keeps the existing bank connection and sync UI.
- `/app/bank-accounts/$bankAccountId` — Bank account transaction page. This shows the transaction table filtered to transactions from the selected bank account.

Existing deep links to ledger account detail pages can remain available if still used by category/account rows.

## Layout and components

Use shadcn primitives and the `sidebar-01` block as the starting point. Sidebar primitives should live under `src/components/ui/` according to the existing shadcn alias configuration. App-specific composition should stay under `src/components/layout/`.

Expected app-specific components:

- `Shell` composes the sidebar provider, app sidebar, responsive sidebar trigger/inset, and the main content region.
- `AppSidebar` renders team header, primary navigation, bank account links, bank connection management link, and user footer.

The main content region should provide consistent page padding and width behavior for all protected app pages. The layout should work on desktop and use the shadcn sidebar responsive behavior on smaller screens.

## Sidebar content

Top:

- Show the current team name from Zero team data.
- Use a safe fallback such as `Penge` while team data is loading.

Primary navigation:

- Home → `/app`
- Transactions → `/app/transactions`
- Categories → `/app/categories`

Bank accounts section:

- List bank accounts for the current team using existing Zero `bankAccounts()` data.
- Each account links to `/app/bank-accounts/$bankAccountId`.
- Show a small empty/loading state when there are no accounts available.
- Include `Manage bank connections` linking to `/app/banks`.

Footer:

- Show the logged-in user, preferring name if available and email as supporting text.
- Preserve sign-out behavior currently implemented in the shell.

## Data flow

Protected route setup remains responsible for authentication, ensuring the personal team, and wrapping protected content in `AppZeroProvider`.

Sidebar data should be read through existing Zero queries:

- `queries.domain.teams()` for the current team name.
- `queries.domain.bankAccounts()` for sidebar bank accounts.

Transaction and category pages should continue to use Zero-backed domain reads. Do not introduce direct server functions or ad-hoc client APIs for app/domain data already available through Zero.

## Page decomposition

The current ledger dashboard mixes category/account balances, transaction review, sync actions, AI categorization actions, and clear-categorization actions. Restructuring should extract focused pieces without changing behavior:

- A transactions-focused page keeps the current transaction review table and transaction-level actions.
- A categories-focused page keeps the current account/category balance overview.
- Shared model-building code should be reused or adapted so account/category balances and transaction rows are derived consistently.
- The bank-account transaction page should reuse the same transaction table path where practical, filtered to rows related to the selected bank account.

## Error and loading states

- Sidebar should render stable fallback content while Zero data loads.
- If there are no bank accounts, show a concise empty state in the Bank accounts section.
- If a bank-account route is opened for an unknown account, show a not-found style message in the page content rather than crashing.
- Existing error handling for categorization, AI categorization, syncing, and sign-out should remain intact.

## Testing and verification

Verification should include:

- Typecheck for route/component type safety.
- Build or equivalent route generation verification.
- Targeted unit tests if page/model extraction changes logic, especially for filtering transactions by bank account.
- Manual smoke test of protected navigation: Home, Transactions, Categories, Manage bank connections, and a bank account transaction page.

## Acceptance criteria

- Protected app uses a shadcn sidebar layout instead of the current top-header navigation.
- Sidebar shows team name at the top and user identity at the bottom.
- Sidebar primary nav contains Home, Transactions, and Categories.
- Bank accounts section lists current team bank accounts and links each account to a filtered transaction page.
- Bank accounts section includes a manage bank connections link to the existing bank connection page.
- Home renders an intentionally minimal placeholder.
- Existing transaction categorization and bank connection workflows still work after the route/layout restructure.
