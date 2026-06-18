import {deriveLedgerAccountBalances, isCategorizationAccount} from '@/ledger/categorization'

export type LedgerDashboardGroup = {id: string; name: string; sortOrder: number | null}
export type LedgerDashboardAccount = {
  id: string
  groupId: string
  name: string
  type: string
  normalBalance: string
  status: string | null
  sortOrder: number | null
}
export type LedgerDashboardTransaction = {
  id: string
  bankTransactionId: string | null
  source: string
  status: string
  date: string | null
  description: string
}
export type LedgerDashboardMovement = {
  id: string
  ledgerTransactionId: string
  debitAccountId: string
  creditAccountId: string
  amount: string | number
  currency: string
  sortOrder: number | null
}
export type LedgerDashboardBankTransaction = {
  id: string
  bankAccountId: string
  amount: string | number
  currency: string
  bookingDate: string | null
  valueDate: string | null
  description: string
}
export type LedgerDashboardBankAccount = {id: string; name: string}

export function buildLedgerDashboardModel(input: {
  groups: ReadonlyArray<LedgerDashboardGroup>
  accounts: ReadonlyArray<LedgerDashboardAccount>
  ledgerTransactions: ReadonlyArray<LedgerDashboardTransaction>
  movements: ReadonlyArray<LedgerDashboardMovement>
  bankTransactions: ReadonlyArray<LedgerDashboardBankTransaction>
  bankAccounts: ReadonlyArray<LedgerDashboardBankAccount>
}) {
  const accounts = input.accounts.map(account => ({...account, status: account.status ?? 'active', sortOrder: account.sortOrder ?? 0}))
  const movements = input.movements.map(movement => ({...movement, amount: String(movement.amount), sortOrder: movement.sortOrder ?? 0}))
  const bankTransactions = input.bankTransactions.map(transaction => ({...transaction, amount: String(transaction.amount)}))
  const balances = deriveLedgerAccountBalances(accounts, movements)
  const accountsById = new Map(accounts.map(account => [account.id, account]))
  const bankTransactionsById = new Map(bankTransactions.map(transaction => [transaction.id, transaction]))
  const bankAccountNamesById = new Map(input.bankAccounts.map(account => [account.id, account.name]))
  const movementsByTransactionId = groupBy(movements, movement => movement.ledgerTransactionId)

  const categorizationAccounts = accounts
    .filter(account => isCategorizationAccount(account))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))

  const accountGroups = [...input.groups]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name))
    .map(group => ({
      id: group.id,
      name: group.name,
      accounts: accounts
        .filter(account => account.groupId === group.id)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
        .map(account => ({...account, balance: balances.get(account.id) ?? '0.0000'})),
    }))

  const transactionRows = input.ledgerTransactions
    .filter(transaction => transaction.source === 'bank_import' && transaction.bankTransactionId)
    .map(transaction => {
      const bankTransaction = transaction.bankTransactionId ? bankTransactionsById.get(transaction.bankTransactionId) : undefined
      const transactionMovements = movementsByTransactionId.get(transaction.id) ?? []
      const categoryAccountIds = new Set(
        transactionMovements.flatMap(movement => [movement.debitAccountId, movement.creditAccountId]).filter(accountId => {
          const account = accountsById.get(accountId)
          return account ? isCategorizationAccount(account) : false
        }),
      )
      const categoryAccountId = categoryAccountIds.size === 1 ? [...categoryAccountIds][0] : null

      return {
        id: transaction.id,
        description: bankTransaction?.description ?? transaction.description,
        date: bankTransaction?.bookingDate ?? bankTransaction?.valueDate ?? transaction.date,
        bankAccountName: bankTransaction ? (bankAccountNamesById.get(bankTransaction.bankAccountId) ?? 'Unknown account') : 'Unknown account',
        amount: bankTransaction?.amount ?? '0.0000',
        currency: bankTransaction?.currency ?? '',
        status: transaction.status,
        needsReview: transaction.status === 'needs_review',
        categoryAccountId,
        categoryLabel: categoryAccountId ? (accountsById.get(categoryAccountId)?.name ?? 'Unknown category') : 'Split',
        isSplit: transactionMovements.length > 1,
        splitLines: transactionMovements.map(movement => {
          const debitAccount = accountsById.get(movement.debitAccountId)
          const categoryAccountIdForMovement = debitAccount && isCategorizationAccount(debitAccount) ? movement.debitAccountId : movement.creditAccountId
          return {accountId: categoryAccountIdForMovement, amount: movement.amount}
        }),
      }
    })
    .sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''))

  return {
    accountGroups,
    categorizationAccounts,
    transactionRows,
    reviewCount: transactionRows.filter(row => row.needsReview).length,
  }
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const groupKey = key(item)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item])
  }
  return groups
}
