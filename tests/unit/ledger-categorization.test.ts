import {describe, expect, it, vi} from 'vitest'
import {
  buildBankLinkedCategorizationPostings,
  deriveLedgerAccountBalances,
  isRealCategorizationAccount,
  validateLedgerPostingsBalance,
} from '@/ledger/categorization'

const uuid = (id: string) => id as `${string}-${string}-${string}-${string}-${string}`

describe('buildBankLinkedCategorizationPostings', () => {
  it('preserves the reconciled bank posting and creates opposite category postings', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid('category-posting-1'))
    const now = new Date('2026-06-18T10:00:00.000Z')

    expect(
      buildBankLinkedCategorizationPostings({
        bankPosting: {
          id: 'bank-posting-1',
          ledgerTransactionId: 'ledger-1',
          accountId: 'checking',
          amount: '-100.0000',
          currency: 'DKK',
          bankTransactionId: 'bank-1',
        },
        lines: [{accountId: 'groceries', amount: '100.00'}],
        now,
      }),
    ).toMatchObject([
      {
        id: 'bank-posting-1',
        ledgerTransactionId: 'ledger-1',
        accountId: 'checking',
        amount: '-100.0000',
        currency: 'DKK',
        bankTransactionId: 'bank-1',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'category-posting-1',
        ledgerTransactionId: 'ledger-1',
        accountId: 'groceries',
        amount: '100.0000',
        currency: 'DKK',
        bankTransactionId: null,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      },
    ])
  })

  it('creates multiple opposite postings for split transactions', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid('posting-1')).mockReturnValueOnce(uuid('posting-2'))

    expect(
      buildBankLinkedCategorizationPostings({
        bankPosting: {
          id: 'bank-posting-1',
          ledgerTransactionId: 'ledger-1',
          accountId: 'checking',
          amount: '-100.5000',
          currency: 'DKK',
          bankTransactionId: 'bank-1',
        },
        lines: [
          {accountId: 'groceries', amount: '70.25'},
          {accountId: 'household', amount: '30.25'},
        ],
      }),
    ).toMatchObject([
      {id: 'bank-posting-1', accountId: 'checking', amount: '-100.5000', bankTransactionId: 'bank-1', sortOrder: 0},
      {id: 'posting-1', accountId: 'groceries', amount: '70.2500', bankTransactionId: null, sortOrder: 1},
      {id: 'posting-2', accountId: 'household', amount: '30.2500', bankTransactionId: null, sortOrder: 2},
    ])
  })

  it('uses negative explanatory postings for positive bank transactions', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid('posting-1'))

    expect(
      buildBankLinkedCategorizationPostings({
        bankPosting: {
          id: 'bank-posting-1',
          ledgerTransactionId: 'ledger-1',
          accountId: 'checking',
          amount: '125.0000',
          currency: 'DKK',
          bankTransactionId: 'bank-1',
        },
        lines: [{accountId: 'salary', amount: '125.00'}],
      }),
    ).toMatchObject([
      {accountId: 'checking', amount: '125.0000', bankTransactionId: 'bank-1', sortOrder: 0},
      {accountId: 'salary', amount: '-125.0000', bankTransactionId: null, sortOrder: 1},
    ])
  })

  it('rejects split totals that do not equal the bank transaction amount', () => {
    expect(() =>
      buildBankLinkedCategorizationPostings({
        bankPosting: {
          id: 'bank-posting-1',
          ledgerTransactionId: 'ledger-1',
          accountId: 'checking',
          amount: '-100.0000',
          currency: 'DKK',
          bankTransactionId: 'bank-1',
        },
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '20.00'},
        ],
      }),
    ).toThrow('Split total must equal the bank transaction amount')
  })

  it('rejects zero and negative split line amounts', () => {
    expect(() =>
      buildBankLinkedCategorizationPostings({
        bankPosting: {
          id: 'bank-posting-1',
          ledgerTransactionId: 'ledger-1',
          accountId: 'checking',
          amount: '-100.0000',
          currency: 'DKK',
          bankTransactionId: 'bank-1',
        },
        lines: [{accountId: 'groceries', amount: '0.00'}],
      }),
    ).toThrow('Split amounts must be positive')
  })
})

describe('validateLedgerPostingsBalance', () => {
  it('rejects postings that are not zero-sum per currency', () => {
    expect(() =>
      validateLedgerPostingsBalance([
        {amount: '-100.0000', currency: 'DKK'},
        {amount: '90.0000', currency: 'DKK'},
      ]),
    ).toThrow('Ledger postings must balance to zero per currency')
  })
})

describe('isRealCategorizationAccount', () => {
  it('allows only active, category-like, non-system, non-bank-linked accounts', () => {
    expect(isRealCategorizationAccount({type: 'expense', status: 'active', systemKey: null, linkedBankAccountId: null})).toBe(true)
    expect(isRealCategorizationAccount({type: 'income', status: 'active', systemKey: null, linkedBankAccountId: null})).toBe(true)
    expect(isRealCategorizationAccount({type: 'savings', status: 'active', systemKey: null, linkedBankAccountId: null})).toBe(true)
    expect(isRealCategorizationAccount({type: 'bank', status: 'active', systemKey: null, linkedBankAccountId: null})).toBe(false)
    expect(isRealCategorizationAccount({type: 'expense', status: 'archived', systemKey: null, linkedBankAccountId: null})).toBe(false)
    expect(isRealCategorizationAccount({type: 'expense', status: 'active', systemKey: 'uncategorized', linkedBankAccountId: null})).toBe(false)
    expect(isRealCategorizationAccount({type: 'expense', status: 'active', systemKey: null, linkedBankAccountId: 'bank-account-1'})).toBe(false)
  })
})

describe('deriveLedgerAccountBalances', () => {
  it('uses normal balance to calculate displayed balances from signed postings', () => {
    expect(
      deriveLedgerAccountBalances(
        [
          {id: 'bank', normalBalance: 'debit'},
          {id: 'groceries', normalBalance: 'credit'},
        ],
        [
          {accountId: 'bank', amount: '-100.0000', currency: 'DKK'},
          {accountId: 'groceries', amount: '100.0000', currency: 'DKK'},
        ],
      ),
    ).toEqual(
      new Map([
        ['bank', '-100.0000'],
        ['groceries', '-100.0000'],
      ]),
    )
  })

  it('does not collapse mixed-currency balances into one amount', () => {
    const balances = deriveLedgerAccountBalances(
      [{id: 'groceries', normalBalance: 'credit'}],
      [
        {accountId: 'groceries', amount: '100.0000', currency: 'DKK'},
        {accountId: 'groceries', amount: '10.0000', currency: 'EUR'},
      ],
    )

    expect(balances.get('groceries')).toBe('Multiple currencies')
  })
})
