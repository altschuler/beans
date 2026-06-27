# App shell and navigation

## Protected app structure

Most authenticated product pages live under `/app`; the protected Ledger route is currently exposed at `/ledger`. The protected route gate handles browser-session validation, personal team setup, Zero provider setup, and then renders the app shell.

The shell itself is route-agnostic. It owns the sidebar frame, not per-page breadcrumbs or page actions.

## Sidebar

The sidebar shows persistent app context:

- current team name, with `Penge` fallback while loading
- primary navigation: Home, Transactions, Categories, Ledger
- bank account links for the current team
- Manage bank accounts
- user menu with theme selection and sign out

Bank account links route to filtered transaction pages for the selected bank account.

## Page-owned layout

Protected pages use `PageLayout` for their own header context.

`PageLayout` provides:

- sidebar trigger
- breadcrumbs
- optional right-aligned actions
- fixed header
- scrollable content region
- page-controlled content padding
- an icon-only Ask Penge trigger after page-owned actions when chat scope is available

This keeps page behavior explicit. For example, Transactions owns its review count, Auto-categorize, Sync all accounts, and More menu in its page header. Categories owns Add group and Add category. Bank accounts owns bank connection management. The chat trigger is shell-owned and consistent across protected app pages that use `PageLayout`.

## Ask Penge chat surface

The authenticated shell owns the root Ask Penge chat surface rather than individual pages. Opening chat from the `PageLayout` trigger uses the current user and team scope from the protected app shell.

On desktop-sized viewports, Ask Penge appears as a right sidebar sibling beside routed content, so the workspace narrows instead of being covered by an overlay. On narrow viewports, the routed page content is hidden while chat is open and the chat header provides a close control to return to the page. The chat system is described in [Team data assistant](./team-data-assistant.md).

## Current page roles

- `/app`: intentionally minimal Home placeholder
- `/app/transactions`: main imported transaction review/categorization table
- `/app/categories`: category and category-group management
- `/app/bank-accounts`: linked bank account management
- `/app/bank-accounts/connect`: bank linking
- `/app/bank-accounts/$bankAccountId`: transaction table filtered to one bank account
- `/app/accounts/$accountId`: ledger account/category detail history
- `/ledger`: lower-level ledger postings view exposed from the sidebar as Ledger

## Layout philosophy

Financial review views should stay dense and stable. The page header provides context and global actions; tables/lists own their own scrolling; normal rows should remain uniform height. Heavy page/card chrome is avoided on table-first pages.
