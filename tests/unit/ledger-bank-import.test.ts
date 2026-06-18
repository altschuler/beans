import {describe, expect, it} from 'vitest'
import {buildBankImportLedgerDraft} from '@/ledger/bank-import'

describe('buildBankImportLedgerDraft', () => {
  it('debits the internal bank account for positive bank transactions', () => {
    expect(
      buildBankImportLedgerDraft({
        teamId: 'team-1',
        bankTransactionId: 'bank-transaction-1',
        bankLedgerAccountId: 'checking-ledger-account',
        oppositeAccountId: 'ready-to-budget',
        amount: '30000.00',
        currency: 'DKK',
        description: 'Salary',
        date: '2026-06-17',
        status: 'confirmed',
        aiConfidence: '0.95',
      }),
    ).toMatchObject({
      transaction: {
        teamId: 'team-1',
        bankTransactionId: 'bank-transaction-1',
        source: 'bank_import',
        status: 'confirmed',
        aiConfidence: '0.95',
        date: '2026-06-17',
        description: 'Salary',
      },
      movement: {
        debitAccountId: 'checking-ledger-account',
        creditAccountId: 'ready-to-budget',
        amount: '30000.00',
        currency: 'DKK',
        sortOrder: 0,
      },
    })
  })

  it('credits the internal bank account for negative bank transactions', () => {
    expect(
      buildBankImportLedgerDraft({
        teamId: 'team-1',
        bankTransactionId: 'bank-transaction-2',
        bankLedgerAccountId: 'checking-ledger-account',
        oppositeAccountId: 'takeaway',
        amount: '-100.50',
        currency: 'DKK',
        description: 'Wolt',
        date: '2026-06-17',
        status: 'needs_review',
        aiConfidence: '0.62',
      }).movement,
    ).toMatchObject({
      debitAccountId: 'takeaway',
      creditAccountId: 'checking-ledger-account',
      amount: '100.50',
      currency: 'DKK',
    })
  })

  it('rejects zero amounts because every movement must move money', () => {
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
