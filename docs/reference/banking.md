# Bank accounts and sync

## Adding bank accounts

The bank accounts page (`/app/bank-accounts`) lets the user:

- view bank accounts
- sync one provider-linked account
- open the connect-account flow

The connect-account flow offers two paths:

- **Connect for automatic sync** links GoCardless accounts.
- **Add transactions yourself** creates a manual account for transactions the user enters directly.

## Bank linking

Penge links external bank accounts through GoCardless. The bank connection page lets the user search Danish institutions and start a bank link flow.

Bank connections store the provider institution id plus the display metadata returned by GoCardless during link start, including institution name and optional logo URL. The bank management UI groups linked accounts under that connection/institution name.

The GoCardless callback creates or updates bank account rows, fetches provider account details for each linked account, stores the available account metadata, and ensures each linked bank account has a corresponding bank-linked ledger account.

## Bank account records

Every bank account has two related records:

- `bank_accounts`: provider/account metadata, sync state, and display name
- `ledger_accounts`: the internal bank-like ledger account used for postings and balances

The ledger account is linked through `ledger_accounts.linked_bank_account_id` and is not an editable category.

Provider-linked accounts have `bank_accounts.provider = 'gocardless'` and belong to a `bank_connections` row. Manual accounts have `bank_accounts.provider = 'manual'`, no bank connection, stable app-generated provider identifiers, idle sync fields, and app-owned manual metadata in `providerAccountRaw`.

## Bank transactions

Provider sync and manual entry both create `bank_transactions` rows. These rows are transaction evidence and should not be changed by categorization, AI, confirmation, or reset actions.

Provider amount strings are parsed at import into canonical scale-4 integer money amounts and stored with their currency code. Invalid amount syntax fails at the import boundary and surfaces through the existing sync error path.

Manual transactions are entered from a manual bank account page. The user provides date, description, and a signed decimal amount; the account and currency come from the manual account. Penge stores them as booked `bank_transactions` with app-generated `providerTransactionId` values and a small manual `raw` marker, then creates the same balanced Uncategorized ledger interpretation used for provider imports.

Manual transactions appear in the existing transaction review flow as uncategorized / needing review. Users categorize them later through the same Transactions page, chat, or AI paths used for synced bank transactions.

## Starting balances

A user can set a bank account starting balance from the individual bank account transaction page. The page shows the account's current balance as the opening-balance posting plus all imported bank transaction movements for that account, so Uncategorized imported transactions are included before they are categorized. The entered balance is the bank balance after the latest imported transaction shown for that account. For provider-linked accounts, the dialog warns when the account has not synced recently, but the warning does not block saving; manual accounts use the same action without sync-age warnings.

Penge calculates the opening balance from imported transaction evidence, not categorized ledger postings:

```txt
opening balance = entered current balance - sum(all bank_transactions.amount for the bank account)
```

This means uncategorized, categorized, reconciled, and unreconciled bank transactions all count equally. Saving replaces any existing opening-balance ledger transaction for that bank account. If the calculated amount is zero, Penge deletes the existing opening-balance transaction and creates no replacement.

The opening-balance ledger transaction uses source `opening_balance`, status `confirmed`, the bank account currency, the linked bank ledger account, and the team's Opening balances system account. Its date is the day before the first imported transaction date when one exists, otherwise today.

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

Sync all lists accessible GoCardless-linked bank accounts and syncs them sequentially. Manual accounts are excluded because they do not sync with a provider. Sync all continues after individual failures and returns a summary with synced, failed, skipped, fetched, and upserted counts.

The UI disables sync-all when there are no syncable accounts, when any syncable account is currently syncing, or while the local sync-all request is pending.

## Write and read paths

Bank connections, accounts, and bank transactions are Zero-backed domain data. Auth/session tables and provider credentials stay server-only and are excluded from Zero.

User-facing manual-account and manual-transaction writes go through Zero custom mutators:

- `banking.createManualBankAccount` creates the manual `bank_accounts` row and linked bank ledger account after checking team access.
- `banking.createManualTransaction` creates a booked manual `bank_transactions` row after checking that the user can access the account and that the account is manual.
- `banking.setStartingBalance` creates, replaces, or removes the opening-balance ledger transaction after checking that the user can access the account team.

Bulk imports, category selection during manual transaction entry, editing manual transactions, and deleting manual transactions are not part of the current manual-entry slice.
