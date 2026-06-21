# Editable Categories Design

## Goal

Rework `/app/categories` into a category and category-group management page.

Users should be able to:

- add category groups
- edit and delete category groups, with deletion limited to empty editable groups
- add categories
- edit category name, description, type, and group
- delete categories only when they have no ledger postings

The page must not allow editing bank-linked ledger accounts or system accounts.

## Data model

Continue using existing ledger tables:

- `ledger_account_groups` represent category groups.
- `ledger_accounts` represent categories and system accounts.
- `ledger_postings` determine balances and category deletion eligibility.

Editable category accounts are `ledger_accounts` rows where:

- `linkedBankAccountId` is null
- `systemKey` is null
- `type` is one of `expense`, `income`, or `savings`

Locked accounts are rows where:

- `linkedBankAccountId` is set, for bank-linked ledger accounts; these should not appear on `/app/categories`
- `systemKey` is set, for system accounts; these should appear locked when relevant

The default chart should put all system accounts in a locked **System accounts** group:

- Ready to budget (`ready_to_budget`)
- Uncategorized (`uncategorized`)
- Opening balances (`opening_balances`)

Remove `Corrections` from the default chart template. No data migration is needed because current data is local development data and can be wiped. The schema change still needs the normal generated database migration and Zero schema regeneration.

Add a group-level system marker so server and UI can lock system groups without relying on the group display name. Proposed schema addition:

- `ledger_account_groups.systemKey`, nullable text
- system group key: `system_accounts`

## Page UI

Keep the flat page style from the current categories cleanup.

Header actions:

- **Add group**
- **Add category**

Grouped list:

- Show editable categories and locked system accounts.
- Do not show bank-linked ledger accounts.
- Render sections by group.
- Group headers show name, account count, optional lock icon, and an **Edit** action.
- Category rows show name, optional description, type label, balance, optional lock icon, and an **Edit** action.
- Do not show inline delete buttons on rows or group headers.

Use `lucide-react` for the lock icon.

## Modals

### Add category

Fields:

- Name
- Description
- Type selector
- Group selector

The type selector should describe what each type means:

- Expense: spending categories used to classify outgoing purchases and bills.
- Income: categories used to classify incoming money such as salary, reimbursements, and interest.
- Savings: goal or envelope-style categories used to track money set aside.

The group selector includes an **Add group** button. Clicking it opens a stacked Add Group modal. After the group is created, select it in the category modal.

### Edit category

Same editable fields as Add category:

- Name
- Description
- Type
- Group

Also include a destructive Delete section inside the modal. The delete button is:

- enabled only when the category is editable and has zero ledger postings
- disabled with explanatory text when the category is locked or has ledger history

### Add group

Field:

- Name

### Edit group

Field:

- Name

Also include a destructive Delete section inside the modal. The delete button is:

- enabled only when the group is editable and empty
- disabled with explanatory text when the group is locked or contains accounts

## Server behavior

All writes must go through Zero mutators. Server mutators are the authorization and invariants boundary.

Add category/group management functions behind these mutators:

- `createCategoryAccount`
- `updateCategoryAccount`
- `deleteCategoryAccount`
- `createCategoryGroup`
- `updateCategoryGroup`
- `deleteCategoryGroup`

Server rules:

- Authenticate from Zero context.
- Authorize access through team membership.
- Never trust client-supplied ownership or lock status.
- Trim names and require non-empty names.
- Allow empty category descriptions.
- Restrict category type to `expense`, `income`, or `savings`.
- Create categories/groups in the current accessible team; if a team id is supplied by the client, verify membership server-side before using it.
- Require selected groups to belong to the user's accessible team and not be locked.
- Reject edits/deletes for bank-linked accounts.
- Reject edits/deletes for system accounts.
- Reject edits/deletes for system groups.
- Reject category deletion when any `ledger_postings` row references the category account.
- Reject group deletion when any `ledger_accounts` row references the group.
- Surface duplicate names as friendly UI errors where practical.

## Client model

Extract category-page-specific model logic rather than overloading transaction dashboard behavior further.

The model should:

- filter out bank-linked ledger accounts
- include editable categories and locked system accounts
- group accounts by ledger account group
- compute balances from postings
- compute account lock state and delete eligibility
- compute group lock state and delete eligibility
- expose clear disabled reasons for modal delete actions

## Error handling

Use existing toast/error patterns:

- Show mutation failures via `showErrorToast`.
- Keep forms open when save/delete fails.
- Disable submit buttons while the corresponding mutation is pending.
- Show inline disabled reasons for destructive actions in edit modals.

## Testing

Add or update tests for:

- default chart contains a locked System accounts group and no Corrections account
- category model filters bank-linked accounts and marks system accounts/groups locked
- category model computes balances and delete eligibility from postings
- mutator schemas accept valid create/update/delete inputs and reject invalid category types/empty names
- server create/update/delete category behavior
- server create/update/delete group behavior
- server rejects other-team writes
- server rejects bank-linked account mutation
- server rejects system account and system group mutation
- server rejects deleting categories with postings
- server rejects deleting non-empty groups
- UI renders Add group and Add category in the page header
- UI renders grouped category rows with lock icons
- UI uses edit modals for delete actions rather than inline delete buttons
- UI disables delete with explanations when deletion is not allowed
- Add Category can open stacked Add Group and select the created group

## Deferred work

Archival/deactivation for categories with ledger history is deferred. `docs/TODO.md` tracks this follow-up. For this design, non-empty categories cannot be deleted.
