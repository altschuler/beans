# App shell and navigation

## Protected app structure

Most authenticated product pages live under `/app`; the protected Ledger route is currently exposed at `/ledger`. The protected route gate handles browser-session validation, personal team setup, Zero provider setup, and then renders the app shell.

The shell itself is route-agnostic. It owns the sidebar frame, not per-page breadcrumbs or page actions.

## Sidebar

The sidebar shows persistent app context:

- current team name, with `Penge` fallback while loading
- primary navigation: Home, Transactions, Categories, Ledger
- bank account links for the current team
- Manage bank connections
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

This keeps page behavior explicit. For example, Transactions owns its review count, Auto-categorize, Sync all accounts, and More menu in its page header. Categories owns Add group and Add category. Bank connections owns Sync all accounts.

## Current page roles

- `/app`: intentionally minimal Home placeholder
- `/app/transactions`: main imported transaction review/categorization table
- `/app/categories`: category and category-group management
- `/app/banks`: bank linking and sync management
- `/app/bank-accounts/$bankAccountId`: transaction table filtered to one bank account
- `/app/accounts/$accountId`: ledger account/category detail history
- `/ledger`: lower-level ledger postings view exposed from the sidebar as Ledger

## Layout philosophy

Financial review views should stay dense and stable. The page header provides context and global actions; tables/lists own their own scrolling; normal rows should remain uniform height. Heavy page/card chrome is avoided on table-first pages.
