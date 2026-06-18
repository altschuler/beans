import {describe, expect, it} from 'vitest'
import {buildLedgerDashboardModel} from '@/components/ledger/ledger-dashboard-model'

describe('buildLedgerDashboardModel', () => {
  it('groups balances and creates transaction rows with category state', () => {
    const model = buildLedgerDashboardModel({
      groups: [{id: 'group-1', name: 'Everyday spending', sortOrder: 0}],
      accounts: [
        {id: 'checking', groupId: 'group-1', name: 'Checking', type: 'bank', normalBalance: 'debit', status: 'active', sortOrder: 0},
        {id: 'uncategorized', groupId: 'group-1', name: 'Uncategorized', type: 'adjustment', normalBalance: 'credit', status: 'active', sortOrder: 1},
        {id: 'groceries', groupId: 'group-1', name: 'Groceries', type: 'expense', normalBalance: 'credit', status: 'active', sortOrder: 2},
      ],
      ledgerTransactions: [
        {
          id: 'ledger-transaction-1',
          bankTransactionId: 'bank-transaction-1',
          source: 'bank_import',
          status: 'needs_review',
          date: '2026-06-18',
          description: 'Netto',
        },
      ],
      movements: [
        {
          id: 'movement-1',
          ledgerTransactionId: 'ledger-transaction-1',
          debitAccountId: 'uncategorized',
          creditAccountId: 'checking',
          amount: '100.00',
          currency: 'DKK',
          sortOrder: 0,
        },
      ],
      bankTransactions: [
        {
          id: 'bank-transaction-1',
          bankAccountId: 'bank-account-1',
          amount: '-100.00',
          currency: 'DKK',
          bookingDate: '2026-06-18',
          valueDate: null,
          description: 'Netto',
        },
      ],
      bankAccounts: [{id: 'bank-account-1', name: 'Checking'}],
    })

    expect(model.reviewCount).toBe(1)
    expect(model.categorizationAccounts.map(account => account.name)).toEqual(['Uncategorized', 'Groceries'])
    expect(model.accountGroups[0]).toMatchObject({name: 'Everyday spending'})
    expect(model.accountGroups[0]?.accounts.find(account => account.id === 'uncategorized')?.balance).toBe('-100.0000')
    expect(model.transactionRows[0]).toMatchObject({
      id: 'ledger-transaction-1',
      description: 'Netto',
      bankAccountName: 'Checking',
      amount: '-100.00',
      currency: 'DKK',
      categoryAccountId: 'uncategorized',
      isSplit: false,
      needsReview: true,
    })
  })
})
