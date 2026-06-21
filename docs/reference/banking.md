# Bank connections and sync

## Bank linking

Penge links bank accounts through GoCardless. The bank management page (`/app/banks`) lets the user:

- search Danish institutions
- start a bank link flow
- view linked accounts
- sync one account
- sync all accounts

The GoCardless callback creates or updates bank account rows and ensures each linked bank account has a corresponding bank-linked ledger account.

## Imported bank accounts

A linked bank account has two related records:

- `bank_accounts`: provider/account metadata, sync state, and display name
- `ledger_accounts`: the internal bank-like ledger account used for postings and balances

The ledger account is linked through `ledger_accounts.linked_bank_account_id` and is not an editable category.

## Imported bank transactions

Bank sync upserts `bank_transactions` from provider data. These rows are imported evidence and should not be changed by categorization, AI, confirmation, or reset actions.

Current sync imports bank transactions and ensures the bank-linked ledger account exists. Categorization can happen later through the Transactions page or AI.

Provider facts that matter for reconciliation — bank account, amount, and currency — are guarded after reconciliation. If a provider later reports conflicting facts for an already reconciled transaction, the sync path should not silently leave the ledger inconsistent.

## Sync state

Bank account sync state lives on `bank_accounts`:

- `syncStatus`
- `syncStartedAt`
- `syncError`
- `lastSyncedAt`

Sync actions claim an account before fetching provider details/transactions. Success marks the account idle and updates `lastSyncedAt`; failure records `syncStatus = 'error'` and `syncError`.

The refresh-safe background-task design is not implemented. Current sync server functions await sync completion before returning to the client.

## Sync all

Sync all lists accessible linked bank accounts and syncs them sequentially. It continues after individual failures and returns a summary with synced, failed, skipped, fetched, and upserted counts.

The UI disables sync-all when there are no accounts, when any account is currently syncing, or while the local sync-all request is pending.

## Read path

Bank connections, accounts, and imported transactions are Zero-backed domain data. Auth/session tables and provider credentials stay server-only and are excluded from Zero.
