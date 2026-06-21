import {describe, expect, it} from 'vitest'
import {buildLedgerDashboardModel} from '@/components/ledger/ledger-dashboard-model'

const baseGroups = [{id: 'group-1', name: 'Everyday spending', sortOrder: 0}]
const baseAccounts = [
  {id: 'checking', groupId: 'group-1', name: 'Checking', type: 'bank', normalBalance: 'debit', status: 'active', sortOrder: 0, systemKey: null, linkedBankAccountId: 'bank-account-1'},
  {id: 'uncategorized', groupId: 'group-1', name: 'Uncategorized', type: 'adjustment', normalBalance: 'credit', status: 'active', sortOrder: 1, systemKey: 'uncategorized', linkedBankAccountId: null},
  {id: 'groceries', groupId: 'group-1', name: 'Groceries', type: 'expense', normalBalance: 'credit', status: 'active', sortOrder: 2, systemKey: null, linkedBankAccountId: null},
]

function buildModelForTransaction(
  ledgerOverrides: Record<string, unknown> = {},
  categoryAccountId = 'groceries',
  bankOverrides: Record<string, unknown> = {},
) {
  return buildLedgerDashboardModel({
    groups: baseGroups,
    accounts: baseAccounts,
    ledgerTransactions: [
      {
        id: 'ledger-transaction-1',
        source: 'bank_import',
        status: 'needs_review',
        categorizedBy: null,
        userConfirmedAt: null,
        userConfirmedBy: null,
        date: '2026-06-18',
        description: 'Netto ledger fallback',
        ...ledgerOverrides,
      },
    ],
    postings: [
      {
        id: 'bank-posting-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'checking',
        amount: '-100.0000',
        currency: 'DKK',
        bankTransactionId: 'bank-transaction-1',
        sortOrder: 0,
      },
      {
        id: 'category-posting-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: categoryAccountId,
        amount: '100.0000',
        currency: 'DKK',
        bankTransactionId: null,
        sortOrder: 1,
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
        aiConfidence: null,
        aiProcessingStartedAt: null,
        aiReasoning: null,
        ...bankOverrides,
      },
    ],
    bankAccounts: [{id: 'bank-account-1', name: 'Checking'}],
  })
}

describe('buildLedgerDashboardModel', () => {
  it('groups balances and creates transaction rows with category state', () => {
    const model = buildModelForTransaction({}, 'uncategorized', {aiConfidence: 1, aiProcessingStartedAt: new Date()})

    expect(model.reviewCount).toBe(1)
    expect(model.aiProcessingCount).toBe(1)
    expect(model.categorizationAccounts.map(account => account.name)).toEqual(['Groceries'])
    expect(model.accountGroups[0]).toMatchObject({name: 'Everyday spending'})
    expect(model.accountGroups[0]?.accounts.find(account => account.id === 'uncategorized')?.balance).toBe('-100.0000')
    expect(model.transactionRows[0]).toMatchObject({
      id: 'bank-transaction-1',
      ledgerTransactionId: 'ledger-transaction-1',
      bankTransactionId: 'bank-transaction-1',
      description: 'Netto',
      date: '2026-06-18',
      bankAccountName: 'Checking',
      amount: '-100.00',
      currency: 'DKK',
      categoryAccountId: null,
      isSplit: false,
      splitLines: [],
      needsReview: true,
      aiConfidence: 1,
      aiProcessing: true,
      aiIndicator: {kind: 'processing', title: 'AI is currently categorizing this transaction'},
    })
  })

  it('shows manual rows with a bright green status dot', () => {
    const model = buildModelForTransaction({status: 'confirmed', categorizedBy: 'user', userConfirmedAt: new Date('2026-06-19T10:00:00.000Z')})

    expect(model.transactionRows[0]?.statusIndicator).toMatchObject({
      kind: 'confirmed',
      title: 'Category confirmed by you',
      className: 'bg-green-600',
      canConfirm: false,
    })
  })

  it('shows user-confirmed AI rows with a bright green status dot that preserves AI reasoning', () => {
    const model = buildModelForTransaction(
      {
        status: 'confirmed',
        categorizedBy: 'ai',
        userConfirmedAt: new Date('2026-06-19T10:00:00.000Z'),
      },
      'groceries',
      {aiConfidence: 2, aiReasoning: 'Matched past Netto grocery transactions.'},
    )

    expect(model.transactionRows[0]?.statusIndicator).toMatchObject({
      kind: 'confirmed',
      title: 'Category confirmed by you. AI originally categorized this transaction. Reason: Matched past Netto grocery transactions.',
      className: 'bg-green-600',
      canConfirm: false,
    })
  })

  it('shows high-confidence AI rows with a softer green confirmable status dot and reasoning', () => {
    const model = buildModelForTransaction({status: 'confirmed', categorizedBy: 'ai'}, 'groceries', {aiConfidence: 2, aiReasoning: 'Matched past Netto grocery transactions.'})

    expect(model.transactionRows[0]?.statusIndicator).toMatchObject({
      kind: 'ai_confident',
      title: 'AI categorized with high confidence; not yet confirmed by you. Reason: Matched past Netto grocery transactions.',
      className: 'bg-green-400',
      canConfirm: true,
    })
  })

  it('shows medium-confidence AI rows as yellow and confirmable', () => {
    const model = buildModelForTransaction({categorizedBy: 'ai'}, 'groceries', {aiConfidence: 1, aiReasoning: 'Merchant looks like groceries.'})

    expect(model.transactionRows[0]?.statusIndicator).toMatchObject({
      kind: 'needs_review',
      title: 'AI suggested a category; review recommended. Reason: Merchant looks like groceries.',
      className: 'bg-yellow-600',
      canConfirm: true,
    })
  })

  it('shows any effectively Uncategorized row as red even when AI confidence is high', () => {
    const model = buildModelForTransaction({status: 'confirmed', categorizedBy: 'ai'}, 'uncategorized', {aiConfidence: 2})

    expect(model.transactionRows[0]?.statusIndicator).toMatchObject({
      kind: 'uncategorized',
      title: 'Transaction is Uncategorized and needs a category',
      className: 'bg-destructive',
      canConfirm: false,
    })
  })

  it('shows processing rows as gray before other status states', () => {
    const model = buildModelForTransaction({userConfirmedAt: new Date('2026-06-19T10:00:00.000Z')}, 'groceries', {aiProcessingStartedAt: new Date()})

    expect(model.transactionRows[0]?.statusIndicator).toMatchObject({
      kind: 'processing',
      title: 'AI is currently categorizing this transaction',
      className: 'bg-muted-foreground',
      canConfirm: false,
    })
  })
})
