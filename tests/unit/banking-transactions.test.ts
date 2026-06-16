import {describe, expect, it} from 'vitest'
import {dateFromForNextSync, normalizeGoCardlessTransaction} from '@/banking/transactions'

describe('normalizeGoCardlessTransaction', () => {
  it('normalizes a booked transaction with a provider id', () => {
    expect(
      normalizeGoCardlessTransaction('booked', {
        transactionId: 'tx-1',
        bookingDate: '2026-06-01',
        valueDate: '2026-06-02',
        transactionAmount: {amount: '-42.50', currency: 'DKK'},
        remittanceInformationUnstructured: 'Groceries',
        creditorName: 'Shop',
      }),
    ).toMatchObject({
      providerTransactionId: 'tx-1',
      status: 'booked',
      bookingDate: '2026-06-01',
      valueDate: '2026-06-02',
      amount: '-42.50',
      currency: 'DKK',
      description: 'Groceries',
      counterpartyName: 'Shop',
    })
  })

  it('creates a stable fallback id when transactionId is missing', () => {
    const input = {
      bookingDate: '2026-06-01',
      transactionAmount: {amount: '100.00', currency: 'DKK'},
      remittanceInformationUnstructured: 'Salary',
    }

    expect(normalizeGoCardlessTransaction('booked', input).providerTransactionId).toBe(
      normalizeGoCardlessTransaction('booked', input).providerTransactionId,
    )
  })

  it('uses the same fallback id when the same transaction moves from pending to booked', () => {
    const input = {
      valueDate: '2026-06-01',
      transactionAmount: {amount: '-12.34', currency: 'DKK'},
      remittanceInformationUnstructured: 'Card purchase',
    }

    expect(normalizeGoCardlessTransaction('booked', input).providerTransactionId).toBe(
      normalizeGoCardlessTransaction('pending', input).providerTransactionId,
    )
  })
})

describe('dateFromForNextSync', () => {
  it('omits date_from for the first sync', () => {
    expect(dateFromForNextSync(null)).toBeUndefined()
  })

  it('overlaps later syncs by five days', () => {
    expect(dateFromForNextSync('2026-06-16')).toBe('2026-06-11')
  })
})
