# Vocabulary

This document maps internal/domain terms to the product language users see in the UI. Use it when naming routes, components, copy, mutators, and tests so code can stay precise without leaking accounting jargon into the product.

## User-facing categories and internal ledger accounts

| Internal term | UI/product term | Notes |
| --- | --- | --- |
| `ledger_account` | Category | In most user-facing category-management UI, a ledger account is shown as a category. This includes expense, income, and savings-style categories. |
| `ledger_account_group` | Category group | A grouping for categories on the Categories page. |
| Category account | Category | Code may use “category account” when it needs to distinguish editable category ledger accounts from bank-linked or system ledger accounts. |
| Bank-linked ledger account | Bank account | A ledger account with `linkedBankAccountId` represents an imported bank account internally. It should not appear as an editable category. Bank-account lifecycle owns it. |
| System ledger account | System account | A locked internal account marked with `systemKey`, such as Ready to budget, Uncategorized, and Opening balances. These support accounting workflows and should not be user-editable categories. |

## Transaction model terms

| Internal term | UI/product term | Notes |
| --- | --- | --- |
| `bank_transaction` | Transaction / imported transaction | External evidence imported from a bank provider. Users should not edit it directly. |
| `ledger_transaction` | Internal interpretation | A balanced accounting event created to explain a bank transaction, split, transfer, manual adjustment, or other accounting action. Avoid exposing this term in normal UI copy. |
| `ledger_posting` | Posting / ledger movement | One signed line in a ledger transaction. Usually internal implementation detail; user-facing UI should talk about categories, splits, transfers, and balances instead. |
| Reconciliation | Matching imported transaction to ledger movement | Internal link between a bank transaction and a ledger posting. Prefer user-facing language such as “categorized”, “split”, or “transfer” where possible. |

## Naming guidance

- Use **Category** in UI copy for editable non-bank, non-system ledger accounts.
- Use **Category group** in UI copy for editable ledger account groups.
- Use **System account** for locked accounts marked by `systemKey`.
- Use **Bank account** for imported/provider accounts and their linked internal ledger accounts.
- Use internal terms like `ledgerAccount`, `ledgerPosting`, and `ledgerTransaction` in code where the accounting model matters.
- Avoid calling bank-linked or system ledger accounts “categories” in UI, even though they share the `ledger_accounts` table.
