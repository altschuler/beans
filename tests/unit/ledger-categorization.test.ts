import {describe, expect, it, vi} from 'vitest'
import {
  buildBankLinkedCategorizationMovements,
  deriveLedgerAccountBalances,
  isCategorizationAccount,
} from '@/ledger/categorization'

const uuid = (id: string) => id as `${string}-${string}-${string}-${string}-${string}`

describe('buildBankLinkedCategorizationMovements', () => {
  it('debits the bank account and credits the category for positive bank transactions', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid('movement-1'))

    expect(
      buildBankLinkedCategorizationMovements({
        ledgerTransactionId: 'ledger-transaction-1',
        bankLedgerAccountId: 'bank-ledger-account',
        bankAmount: '125.00',
        currency: 'DKK',
        lines: [{accountId: 'salary', amount: '125.00'}],
        now: new Date('2026-06-18T10:00:00.000Z'),
      }),
    ).toEqual([
      {
        id: 'movement-1',
        ledgerTransactionId: 'ledger-transaction-1',
        debitAccountId: 'bank-ledger-account',
        creditAccountId: 'salary',
        amount: '125.0000',
        currency: 'DKK',
        sortOrder: 0,
        createdAt: new Date('2026-06-18T10:00:00.000Z'),
        updatedAt: new Date('2026-06-18T10:00:00.000Z'),
      },
    ])
  })

  it('debits categories and credits the bank account for negative split transactions', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid('movement-1')).mockReturnValueOnce(uuid('movement-2'))

    expect(
      buildBankLinkedCategorizationMovements({
        ledgerTransactionId: 'ledger-transaction-1',
        bankLedgerAccountId: 'bank-ledger-account',
        bankAmount: '-100.50',
        currency: 'DKK',
        lines: [
          {accountId: 'groceries', amount: '70.25'},
          {accountId: 'household', amount: '30.25'},
        ],
        now: new Date('2026-06-18T10:00:00.000Z'),
      }),
    ).toMatchObject([
      {
        id: 'movement-1',
        debitAccountId: 'groceries',
        creditAccountId: 'bank-ledger-account',
        amount: '70.2500',
        sortOrder: 0,
      },
      {
        id: 'movement-2',
        debitAccountId: 'household',
        creditAccountId: 'bank-ledger-account',
        amount: '30.2500',
        sortOrder: 1,
      },
    ])
  })

  it('rejects split totals that do not equal the bank transaction amount', () => {
    expect(() =>
      buildBankLinkedCategorizationMovements({
        ledgerTransactionId: 'ledger-transaction-1',
        bankLedgerAccountId: 'bank-ledger-account',
        bankAmount: '-100.00',
        currency: 'DKK',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '20.00'},
        ],
      }),
    ).toThrow('Split total must equal the bank transaction amount')
  })

  it('rejects zero and negative split line amounts', () => {
    expect(() =>
      buildBankLinkedCategorizationMovements({
        ledgerTransactionId: 'ledger-transaction-1',
        bankLedgerAccountId: 'bank-ledger-account',
        bankAmount: '-100.00',
        currency: 'DKK',
        lines: [{accountId: 'groceries', amount: '0.00'}],
      }),
    ).toThrow('Split amounts must be positive')
  })
})

describe('isCategorizationAccount', () => {
  it('allows active non-bank ledger accounts only', () => {
    expect(isCategorizationAccount({type: 'expense', status: 'active'})).toBe(true)
    expect(isCategorizationAccount({type: 'bank', status: 'active'})).toBe(false)
    expect(isCategorizationAccount({type: 'expense', status: 'archived'})).toBe(false)
  })
})

describe('deriveLedgerAccountBalances', () => {
  it('uses normal balance to calculate displayed balances', () => {
    const balances = deriveLedgerAccountBalances(
      [
        {id: 'checking', normalBalance: 'debit'},
        {id: 'takeaway', normalBalance: 'credit'},
      ],
      [
        {debitAccountId: 'takeaway', creditAccountId: 'checking', amount: '100.00'},
        {debitAccountId: 'checking', creditAccountId: 'income', amount: '500.00'},
      ],
    )

    expect(balances.get('checking')).toBe('400.0000')
    expect(balances.get('takeaway')).toBe('-100.0000')
  })
})
