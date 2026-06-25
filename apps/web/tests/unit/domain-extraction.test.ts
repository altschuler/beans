import {describe, expect, it} from 'vitest'

import {buildBankTransactionCategorizationPostings, validateLedgerPostingsBalance} from '@penge/domain/categorization'
import {CategorizationRevisionConflictError, normalizeAiReasoning} from '@penge/domain/categorization-service'
import {DEFAULT_CURRENCY, parseDecimalMoneyToAmount} from '@penge/domain/money'
import {searchBankTransactions} from '@penge/domain/read-projections'
import {bankTransactions} from '@penge/domain/schema'

describe('domain extraction public imports', () => {
  it('exposes shared categorization, money, schema, service, and read-projection modules', () => {
    expect(DEFAULT_CURRENCY).toBe('DKK')
    expect(parseDecimalMoneyToAmount('12.34')).toBe(123_400)
    expect(bankTransactions).toBeDefined()
    expect(normalizeAiReasoning('  useful reason  ')).toBe('useful reason')
    expect(new CategorizationRevisionConflictError('bt-1', 1, 2).code).toBe('categorization_revision_conflict')
    expect(typeof searchBankTransactions).toBe('function')

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
