import {describe, expect, it} from 'vitest'
import {buildBankImportLedgerDraft} from '@/ledger/bank-import'

describe('buildBankImportLedgerDraft', () => {
  it('creates balanced postings for positive bank transactions', () => {
    const draft = buildBankImportLedgerDraft({
      teamId: 'team-1',
      bankTransactionId: 'bank-transaction-1',
      bankLedgerAccountId: 'checking-ledger-account',
      oppositeAccountId: 'ready-to-budget',
      amount: '30000.00',
      currency: 'DKK',
      description: 'Salary',
      date: '2026-06-17',
      status: 'confirmed',
      aiConfidence: 2,
    })

    expect(draft).toMatchObject({
      transaction: {
        teamId: 'team-1',
        source: 'bank_import',
        status: 'confirmed',
        aiConfidence: 2,
        aiProcessingStartedAt: null,
        categorizedBy: null,
        date: '2026-06-17',
        description: 'Salary',
      },
    })
    expect(draft.transaction).not.toHaveProperty('bankTransactionId')
    expect(draft.postings).toMatchObject([
      {accountId: 'checking-ledger-account', amount: '30000.0000', currency: 'DKK', bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'ready-to-budget', amount: '-30000.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
    ])
  })

  it('creates balanced postings for negative bank transactions', () => {
    const draft = buildBankImportLedgerDraft({
      teamId: 'team-1',
      bankTransactionId: 'bank-transaction-2',
      bankLedgerAccountId: 'checking-ledger-account',
      oppositeAccountId: 'takeaway',
      amount: '-100.50',
      currency: 'DKK',
      description: 'Wolt',
      date: '2026-06-17',
      status: 'needs_review',
      aiConfidence: 1,
    })

    expect(draft.postings).toMatchObject([
      {accountId: 'checking-ledger-account', amount: '-100.5000', currency: 'DKK', bankTransactionId: 'bank-transaction-2', sortOrder: 0},
      {accountId: 'takeaway', amount: '100.5000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
    ])
  })

  it('rejects zero amounts because every import must create non-zero postings', () => {
    expect(() =>
      buildBankImportLedgerDraft({
        teamId: 'team-1',
        bankTransactionId: 'bank-transaction-3',
        bankLedgerAccountId: 'checking-ledger-account',
        oppositeAccountId: 'uncategorized',
        amount: '0.00',
        currency: 'DKK',
        description: 'Zero',
        date: '2026-06-17',
        status: 'needs_review',
      }),
    ).toThrow('Bank transaction amount must be non-zero')
  })
})
