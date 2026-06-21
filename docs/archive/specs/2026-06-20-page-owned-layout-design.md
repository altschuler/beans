# Page-Owned Layout Design

## Goal

Refactor the authenticated app layout so each page owns its own header context: breadcrumbs, optional actions, and content sizing. This removes route-specific breadcrumb/action inference from the shell and makes it easy for `/app/transactions` to render its review count, Auto-categorize, sync, and more menu in the fixed page header.

## Scope

In scope:

- Add an app-specific `PageLayout` component under `src/components/`, not `src/components/ui/`.
- Move protected app breadcrumb ownership from `Shell` into each `/app/*` page or page-level dashboard component.
- Support optional right-aligned header actions.
- Make the page header fixed by default while page content scrolls below it.
- Migrate all current protected `/app/*` pages to use `PageLayout`:
  - `/app`
  - `/app/transactions`
  - `/app/categories`
  - `/app/banks`
  - `/app/bank-accounts/$bankAccountId`
  - `/app/accounts/$accountId`
- Resolve the `docs/TODO.md` transactions header-action item by moving transaction global actions into the `PageLayout` action slot.

Out of scope:

- Changing sidebar navigation behavior.
- Changing transaction categorization, AI categorization, sync, or clear-categorization behavior.
- Adding new routes or new domain data reads/writes.
- Introducing a portal/header-slot system.

## Architecture

`Shell` should become route-agnostic. It continues to compose:

- `SidebarProvider`
- `AppSidebar`
- `SidebarInset`
- protected page children

`Shell` should no longer:

- inspect the current pathname to infer breadcrumbs
- query bank accounts or ledger accounts only for breadcrumb labels
- special-case transactions or categories content classes
- render the page breadcrumb/header row

`PageLayout` should become the common page frame for protected app pages. It renders the fixed header row and a scrollable content area. Pages pass their own breadcrumb data and optional actions directly.

## `PageLayout` API

Planned component location:

- `src/components/page-layout.tsx`

Planned props:

```ts
type PageLayoutBreadcrumb = {
  title: string
  to?: string
}

type PageLayoutProps = {
  breadcrumbs: PageLayoutBreadcrumb[]
  actions?: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
}
```

Behavior:

- Render the sidebar trigger at the start of the header.
- Render shadcn breadcrumb primitives using TanStack `Link` for linked breadcrumb items.
- Render the last breadcrumb as `BreadcrumbPage`.
- Render `actions` right-aligned when provided.
- Keep the header outside the scroll container.
- Use a scrollable content region like `min-h-0 flex-1 overflow-auto`.
- Do not provide default content padding; pages own their own padding through `contentClassName`.
- Allow pages to choose content padding/sizing with `contentClassName`, for example document-style pages can use `p-4 md:p-6 lg:p-8` and table-first pages can use `p-0`.

## Page migration

### `/app`

The home route wraps its current placeholder content in:

```tsx
<PageLayout breadcrumbs={[{title: 'Home'}]}>...</PageLayout>
```

### `/app/transactions`

The transactions page owns:

- `breadcrumbs={[{title: 'Transactions'}]}`
- header actions containing:
  - needs-review count
  - AI processing indicator when present
  - Auto-categorize button
  - Sync all accounts button
  - More menu with Clear categorizations

The action logic remains owned by the transactions dashboard code. Only the placement changes from the in-page action bar to the fixed `PageLayout` header action slot.

The transaction table should remain in a full-height scrollable content area with no page-level card wrapper.

### `/app/categories`

The categories page owns:

```tsx
<PageLayout breadcrumbs={[{title: 'Categories'}]} contentClassName="p-3 md:p-4">
  ...
</PageLayout>
```

The simple category count bar remains in page content. No transaction actions appear on this page.

### `/app/banks`

The bank connections page owns:

- `breadcrumbs={[{title: 'Manage bank connections'}]}`
- optional header action for the existing Sync all accounts button

The existing connect-bank, linked-accounts, and transaction-list cards remain unchanged except for removal of redundant in-page title/action chrome where appropriate.

### `/app/bank-accounts/$bankAccountId`

The bank account transaction page resolves the bank account name from existing Zero bank-account data and owns:

```tsx
<PageLayout breadcrumbs={[{title: selectedBankAccount?.name ?? 'Bank account'}]}>...</PageLayout>
```

The dashboard content keeps the existing not-found state if the bank account is missing. The in-content title block can be removed because the breadcrumb header carries the page context.

### `/app/accounts/$accountId`

The account detail page owns:

```tsx
<PageLayout breadcrumbs={[{title: 'Categories', to: '/app/categories'}, {title: model.kind === 'not_found' ? 'Account' : model.title}]}>...</PageLayout>
```

The account detail content keeps current balance, period controls, chart, and activity cards unchanged.

## Dynamic labels and fallbacks

Dynamic labels should be resolved in the page or page-level component that already reads the relevant Zero data.

Fallbacks:

- Unknown bank account: breadcrumb title `Bank account`.
- Unknown ledger account: breadcrumb path `Categories / Account`.
- Missing or loading team/sidebar data remains handled by the sidebar as today.

## Scrolling and sizing

The fixed-header behavior should be structural rather than route-specific:

- `Shell`/`SidebarInset` should provide a full-height flex column.
- `PageLayout` should use `flex h-svh min-h-0 flex-col` or equivalent inside the inset.
- Header should be `shrink-0`.
- Content should be `min-h-0 flex-1 overflow-auto`.

Pages that need their own nested full-height layout, especially transactions, can use `contentClassName="p-0"` and keep their internal `flex h-full min-h-0` structure.

## Testing

Update or add tests for:

- `PageLayout` breadcrumb rendering, linked crumbs, actions, and scroll/header structure.
- `Shell` no longer infers or renders breadcrumbs from route paths.
- `/app/transactions` renders global actions in the `PageLayout` header and no longer in an in-content action bar.
- `/app/categories` still renders category count and category links without transaction actions.
- `/app/banks` still renders bank connection workflows, with sync-all available in the header if moved there.
- Dynamic account breadcrumbs use account names when data is present and safe fallbacks when missing.

Existing model tests should remain unchanged unless implementation moves data/model boundaries.

## Acceptance criteria

- All protected `/app/*` pages use `PageLayout`.
- `Shell` is route-agnostic and does not own breadcrumbs or page actions.
- Page header/breadcrumbs/actions remain fixed while content scrolls.
- `/app/transactions` header contains review count, Auto-categorize, sync, and more menu actions.
- Existing transaction, category, bank connection, bank-account transaction, and account-detail behavior is preserved.
- `docs/TODO.md` item about moving `/transactions` actions into the shell/header area is resolved or removed as completed.
