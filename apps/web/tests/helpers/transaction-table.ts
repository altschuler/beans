import type {CategorizationAccountOption, TransactionTableRow, TransferAccountOption} from '@/components/transaction-table'

export const testCategorizationAccounts: CategorizationAccountOption[] = [
  {id: 'groceries', name: 'Groceries'},
  {id: 'household', name: 'Household'},
]

export const testTransferAccounts: TransferAccountOption[] = [
  {id: 'checking-ledger', bankAccountId: 'bank-account-1', name: 'Checking'},
  {id: 'savings-ledger', bankAccountId: 'bank-account-2', name: 'Savings'},
]

export function buildTransactionTableRow(overrides: Partial<TransactionTableRow> = {}): TransactionTableRow {
  return {
    id: 'bank-transaction-1',
    ledgerTransactionId: 'ledger-transaction-1',
    bankTransactionId: 'bank-transaction-1',
    bankAccountId: 'bank-account-1',
    description: 'Netto',
    date: '2026-06-18',
    bankAccountName: 'Checking',
    amount: -1_000_000,
    currency: 'DKK',
    status: 'needs_review',
    needsReview: true,
    aiConfidence: 1,
    aiProcessing: false,
    canCategorize: true,
    statusIndicator: {
      kind: 'needs_review',
      title: 'Review recommended',
      ariaLabel: 'Review recommended',
      className: 'bg-yellow-600',
      canConfirm: true,
    },
    aiIndicator: {
      kind: 'needs_review',
      title: 'Review recommended',
      ariaLabel: 'Review recommended',
      className: 'bg-yellow-600',
      canConfirm: true,
    },
    categoryAccountId: 'groceries',
    categoryLabel: 'Groceries',
    isSplit: false,
    splitLines: [],
    ...overrides,
  }
}
