# Category Selector Split and AI Actions Design

## Status

Draft approved in conversation on 2026-06-21. Not committed; project planning guidance says specs are not committed unless requested.

## Summary

Fold the transaction row's AI categorize and split actions into the category selector popover. The normal popover keeps category/transfer search and choices, with compact AI and Split buttons beside the search input. Split opens inside the same popover as an alternate mode with a back arrow to return to category selection.

This removes the separate row-level AI/Split buttons, keeps transaction rows a uniform height again, and makes categorization-related actions live in one place.

## Source documents and investigated files

Source-of-truth docs read:

- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/VOCABULARY.md`
- `docs/PLANS.md`
- `docs/specs/2026-06-21-bank-transaction-first-categorization-cleanup-design.md`

Files investigated:

- `src/components/ledger/ledger-dashboard.tsx`
- `src/components/transaction-table/transaction-table.tsx`
- `src/components/transaction-table/transaction-row.tsx`
- `src/components/transaction-table/category-selector.tsx`
- `src/components/transaction-table/split-editor.tsx`
- `src/components/transaction-table/types.ts`
- `tests/unit/ledger-dashboard.test.ts`
- `tests/unit/transaction-table.test.ts`

## Goals

- Move the row AI categorize action into the category selector popover.
- Move the split editor into the category selector popover.
- Reuse and adapt the existing extracted `SplitEditor` component.
- Keep existing category, transfer, AI, and split save behavior.
- Keep the row layout compact and uniform.
- Improve split editing convenience with a fill-remaining action.

## Non-goals

- Changing server categorization semantics.
- Changing AI categorization server behavior.
- Changing confirmation/status behavior.
- Redesigning the full transaction table.
- Adding split validation beyond existing save validation, except for UI minimum-line controls.

## Proposed UI behavior

### Normal category selector mode

The category cell renders a single `CategorySelector` control.

When opened, the popover shows:

1. Search input for categories/transfers.
2. Compact AI categorize button next to search.
3. Compact Split button next to search.
4. Transfer and category option sections as today.

Selecting a category or transfer calls the existing categorization callback with `bankTransactionId` and closes the popover.

Clicking AI:

- uses the existing single-row AI callback with the row's `bankTransactionId`;
- closes the popover immediately;
- preserves current disabled rules: unavailable when the row cannot be categorized, does not need review, AI is globally pending, or this row is already processing.

Clicking Split switches the same popover to split mode.

### Split mode

Split mode replaces the category/transfer list inside the popover.

The split editor header contains:

- a back arrow button that returns to normal category selector mode;
- title: `Split transaction`;
- an Add line button.

The footer contains Cancel and Save split.

- Back returns to the category list without closing the popover.
- Cancel closes the popover and discards unsaved split edits.
- Save calls the existing split save flow; on success, it closes the popover and discards local split state.

### Split line rules

The split editor must maintain at least two split lines.

- Opening split mode initializes from existing split lines when a row is already split.
- Otherwise it initializes with two lines.
- Remove is disabled or omitted whenever removing would leave fewer than two lines.
- Add line appends a blank line with the first available category.

Each split line has an accessible `Fill remaining amount` icon button.

Clicking it overwrites that line's amount with:

```text
absolute transaction total - sum(other split line amounts)
```

This is a convenience action only. Existing save validation remains the authority for positive amounts and total matching.

## Component design

### `TransactionRow`

`TransactionRow` should stop owning split editor state and should stop rendering an inline split-detail `<tr>`.

It passes the AI and split-related callbacks to `CategorySelector`:

- `isAiRequestPending`
- `onAiCategorizeOne(bankTransactionId)`
- `onSaveSplit(row, lines)`

The category cell contains only the selector control. The status and amount cells stay unchanged.

### `CategorySelector`

`CategorySelector` owns the popover mode and split draft state:

```ts
type SelectorMode = 'select' | 'split'
```

Responsibilities:

- render the normal search/actions/options view;
- switch to split mode when Split is clicked;
- initialize split lines for the current row;
- close/reset state after category selection, AI start, Cancel, or successful split save;
- keep search state scoped to select mode.

### `SplitEditor`

Reuse the existing extracted component in `src/components/transaction-table/split-editor.tsx`.

Adapt it for popover use:

- hardcode a minimum of two split lines;
- accept the transaction amount required for fill-remaining;
- render compact icon controls for remove and fill-remaining;
- keep accessible labels/titles for icon buttons;
- avoid styling that assumes it is an inline expanded table row.

## Virtualizer cleanup

The inline split editor previously made transaction rows variable-height. Moving split editing into the popover means table rows are uniform again.

Implementation should revisit `TransactionTable` virtualizer setup and remove or simplify any row-height measuring code that only existed for inline split rows. A simple fixed estimate should be sufficient unless another row-height feature remains.

## Error handling

No server error behavior changes.

- Category/transfer errors still use `showErrorToast` through the existing dashboard callback.
- AI errors still use the existing AI callback and toast behavior.
- Split save errors still flow through `saveDashboardSplitTransaction` and `showErrorToast`.
- The split popover only closes on successful save.

## Accessibility and design system

- Continue using `lucide-react` icons.
- Icon-only buttons need accessible `aria-label` and/or `title` text.
- The category trigger keeps a descriptive label such as `Category for Netto`.
- The AI, Split, Back, Remove, and Fill remaining buttons need explicit accessible names.
- Compact controls should match existing button sizing and spacing.

## Testing strategy

Update or add unit tests around the transaction table/dashboard components:

- Row renders a single category selector control, not separate row-level AI/Split buttons beside it.
- The category selector popover exposes AI and Split actions beside the search input.
- AI action calls the existing row AI callback with `bankTransactionId` and closes/starts as before.
- Split mode renders inside the popover with back, cancel, and save behavior.
- Split mode initializes with at least two lines.
- Remove cannot reduce split lines below two.
- Fill remaining overwrites the selected line amount with the computed remainder.
- Successful split save closes the popover.
- Virtualizer expectations are simplified if row measuring code is removed.

Focused verification:

```bash
pnpm vitest run tests/unit/transaction-table.test.ts tests/unit/ledger-dashboard.test.ts
```

Broader verification before completion:

```bash
pnpm typecheck
pnpm build
```

## Open decisions

None. The approved behavior is:

- layout direction A: search row with AI/Split buttons next to the search input;
- AI closes the popover immediately;
- Split uses a back arrow to return to category selection;
- Cancel closes/discards;
- split editor maintains at least two lines;
- fill remaining overwrites the selected line amount.
