import {describe, expect, it} from 'vitest'
import {
  MONEY_FACTOR,
  absoluteMoneyAmount,
  assertSafeMoneyAmount,
  formatMoneyAmount,
  formatMoneyDecimal,
  moneySign,
  parseDecimalMoneyToAmount,
} from '@penge/domain/money'

describe('parseDecimalMoneyToAmount', () => {
  it('parses decimal money strings to scale-4 integer amounts', () => {
    expect(MONEY_FACTOR).toBe(10_000)
    expect(parseDecimalMoneyToAmount('100')).toBe(1_000_000)
    expect(parseDecimalMoneyToAmount('100.00')).toBe(1_000_000)
    expect(parseDecimalMoneyToAmount('-42.50')).toBe(-425_000)
    expect(parseDecimalMoneyToAmount('0.0001')).toBe(1)
  })

  it('rounds provider values to the nearest scale-4 amount with halves away from zero', () => {
    expect(parseDecimalMoneyToAmount('42.12344')).toBe(421_234)
    expect(parseDecimalMoneyToAmount('42.12345')).toBe(421_235)
    expect(parseDecimalMoneyToAmount('-42.12344')).toBe(-421_234)
    expect(parseDecimalMoneyToAmount('-42.12345')).toBe(-421_235)
  })

  it('rejects invalid decimal inputs', () => {
    expect(() => parseDecimalMoneyToAmount('')).toThrow('Invalid money amount')
    expect(() => parseDecimalMoneyToAmount('12,34')).toThrow('Invalid money amount')
    expect(() => parseDecimalMoneyToAmount('1.2.3')).toThrow('Invalid money amount')
    expect(() => parseDecimalMoneyToAmount('Infinity')).toThrow('Invalid money amount')
  })
})

describe('safe integer validation', () => {
  it('accepts safe integer money amounts and rejects unsafe or fractional values', () => {
    expect(() => assertSafeMoneyAmount(1_000_000)).not.toThrow()
    expect(() => assertSafeMoneyAmount(1.5)).toThrow('Money amount must be a safe integer')
    expect(() => assertSafeMoneyAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow('Money amount must be a safe integer')
  })
})

describe('money formatting', () => {
  it('formats scaled amounts as conservative decimal strings plus currency code', () => {
    expect(formatMoneyAmount(1_000_000, 'DKK')).toBe('100.00 DKK')
    expect(formatMoneyAmount(-425_000, 'DKK')).toBe('-42.50 DKK')
    expect(formatMoneyAmount(0, 'DKK')).toBe('0.00 DKK')
    expect(formatMoneyAmount(1, 'DKK')).toBe('0.0001 DKK')
  })

  it('uses normal currency decimals unless scale-4 precision would be hidden', () => {
    expect(formatMoneyAmount(1_000_000, 'JPY')).toBe('100 JPY')
    expect(formatMoneyAmount(1_000_001, 'JPY')).toBe('100.0001 JPY')
    expect(formatMoneyDecimal(702_500, 'DKK')).toBe('70.25')
  })
})

describe('integer helpers', () => {
  it('derives absolute values and signs without decimal conversion', () => {
    expect(absoluteMoneyAmount(-425_000)).toBe(425_000)
    expect(absoluteMoneyAmount(425_000)).toBe(425_000)
    expect(moneySign(-1)).toBe(-1)
    expect(moneySign(0)).toBe(0)
    expect(moneySign(1)).toBe(1)
  })
})
