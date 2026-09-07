import {describe, expect, it} from 'vitest'

import {buildBankTransactionCategorizationPostings, validateLedgerPostingsBalance} from '@penge/domain/categorization'
import {DEFAULT_CURRENCY, parseDecimalMoneyToAmount} from '@penge/domain/money'
import {bankTransactions} from '@penge/domain/schema'

describe('domain extraction public imports', () => {
  it('exposes shared categorization, money, and schema modules', () => {
    expect(DEFAULT_CURRENCY).toBe('DKK')
    expect(parseDecimalMoneyToAmount('12.34')).toBe(123_400)
    expect(bankTransactions).toBeDefined()

    const postings = buildBankTransactionCategorizationPostings({
      ledgerTransactionId: 'lt-1',
      source: {bankTransactionId: 'bt-1', bankLedgerAccountId: 'bank-ledger', amount: -1_000_000, currency: 'DKK'},
      lines: [{accountId: 'groceries', amount: '100.00'}],
      now: new Date('2026-06-25T00:00:00.000Z'),
    })
    validateLedgerPostingsBalance(postings)
    expect(postings.map(posting => posting.accountId)).toEqual(['bank-ledger', 'groceries'])
  })
})
