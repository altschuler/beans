# Categories

## What categories are

In the product, a category is an editable ledger account used to classify transactions or track money. Category groups organize categories on `/app/categories`.

Editable category accounts are ledger accounts where:

- `linkedBankAccountId` is null
- `systemKey` is null
- `type` is `expense`, `income`, or `savings`

Bank-linked ledger accounts and system accounts share the ledger account table but are not editable categories.

## System accounts and locked groups

Penge creates locked system accounts for internal workflows:

- Ready to budget
- Uncategorized
- Opening balances

System accounts live in a locked System accounts group marked by `systemKey`, not just by display name. They can appear in category management as locked rows so users understand they exist, but users cannot edit or delete them.

The default chart no longer includes a Corrections account.

## Category management page

`/app/categories` is a management page, not just a static balance overview. It provides:

- Add group
- Add category
- Edit group
- Edit category
- Delete group when empty and editable
- Delete category when editable and unused by ledger postings

Rows show category name, optional description, type label, balance, lock state, and an Edit action. Destructive deletion lives inside edit dialogs rather than inline row buttons.

## Category types

Category type affects product meaning and ledger display behavior:

- **Expense**: outgoing purchases and bills
- **Income**: incoming money such as salary, reimbursements, and interest
- **Savings**: goal/envelope-style categories used to track money set aside

Current editable categories use credit-normal display behavior.

## Balances and delete eligibility

Category balances are derived from ledger postings. They are not user-editable fields.

Deletion rules protect history:

- a category with any ledger postings cannot be deleted
- a group containing any accounts cannot be deleted
- bank-linked accounts, system accounts, and system groups cannot be edited or deleted

Archival/deactivation for categories with history is deferred and tracked as follow-up work.

## Server boundary

Category and group management writes use Zero mutators with server-side authorization. The server trims names, checks team membership, validates category type, verifies group/account ownership, rejects locked rows, and enforces deletion rules from persisted ledger data.
