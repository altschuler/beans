# Product principles

## Immutable evidence, editable interpretation

Penge separates what the bank says happened from how the user wants to account for it.

- **Bank transactions** are imported evidence. They store provider facts such as account, amount, currency, date, description, counterparty, and raw payload.
- **Ledger transactions and postings** are Penge's interpretation of that evidence. They explain whether a bank transaction is groceries, salary, a split, a transfer, or something else.

User actions should edit the interpretation layer, not imported provider evidence. This keeps imported bank data auditable while still letting users recategorize, split, confirm, clear, or re-run AI categorization. Manually maintained bank accounts are different: because they have no provider evidence source, users must be able to maintain their transactions directly.

## User-facing language hides the accounting machinery

The product should say things like:

- transaction
- category
- category group
- bank account
- split transaction
- transfer to/from account
- confirm category

The code can use ledger terms where precision matters, but normal UI should not make users think in ledger transactions and postings.

## Rows are bank-transaction-first

The Transactions page is about imported bank transactions. Each visible row is identified by `bankTransactionId`; the related `ledgerTransactionId` may be absent or may change when the interpretation is replaced.

This is intentional. The bank transaction is the stable user-facing object. Ledger transactions and postings are replaceable internal explanations.

## Team data is the security boundary

Domain data belongs to teams. A signed-in user can read or mutate team-owned data only through team membership. Client-side filtering and hidden UI are convenience, not authorization.

Zero is the read path for synced app/domain data. Ordinary user-facing domain writes use Zero mutators. Long-running external orchestration, such as bank provider calls and LLM calls, uses server functions or server-only services.

## Design favors calm review workflows

The app is for financial review, not marketing. UI should stay dense, calm, token-driven, and easy to scan. Transactions and categories should use compact tables/lists, status dots, concise actions, and page-owned headers rather than heavy page chrome.
