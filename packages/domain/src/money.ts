export const MONEY_SCALE = 4
export const MONEY_FACTOR = 10_000
export const DEFAULT_CURRENCY = 'DKK'

export type Money = {
  amount: number
  currency: string
}

export function assertSafeMoneyAmount(amount: number): asserts amount is number {
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Money amount must be a safe integer')
  }
}

export function parseDecimalMoneyToAmount(value: string) {
  const trimmed = value.trim()
  const sign = trimmed.startsWith('-') ? -1 : 1
  const unsigned = trimmed.replace(/^[+-]/, '')
  const [wholePart = '', fractionalPart = ''] = unsigned.split('.')

  if (!/^\d+$/.test(wholePart) || !/^\d*$/.test(fractionalPart) || unsigned.split('.').length > 2) {
    throw new Error('Invalid money amount')
  }

  const paddedFraction = fractionalPart.padEnd(MONEY_SCALE + 1, '0')
  const keptFraction = paddedFraction.slice(0, MONEY_SCALE)
  const roundingDigit = Number(paddedFraction[MONEY_SCALE] ?? '0')
  const wholeUnits = Number(wholePart) * MONEY_FACTOR
  const fractionalUnits = Number(keptFraction)
  const roundedAbsolute = wholeUnits + fractionalUnits + (roundingDigit >= 5 ? 1 : 0)
  const amount = sign * roundedAbsolute
  assertSafeMoneyAmount(amount)
  return amount
}

export function formatMoneyAmount(amount: number, currency: string) {
  return `${formatMoneyDecimal(amount, currency)} ${currency}`
}

export function formatMoneyDecimal(amount: number, currency: string) {
  assertSafeMoneyAmount(amount)

  const sign = amount < 0 ? '-' : ''
  const absolute = Math.abs(amount)
  const whole = Math.trunc(absolute / MONEY_FACTOR)
  const fractional = String(absolute % MONEY_FACTOR).padStart(MONEY_SCALE, '0')
  const normalDigits = currencyFractionDigits(currency)
  const lastNonZeroFractionIndex = fractional.search(/0*$/)
  const significantFractionDigits = lastNonZeroFractionIndex === 0 ? 0 : lastNonZeroFractionIndex
  const digits = Math.min(MONEY_SCALE, Math.max(normalDigits, significantFractionDigits))

  if (digits === 0) return `${sign}${whole}`
  return `${sign}${whole}.${fractional.slice(0, digits)}`
}

export function absoluteMoneyAmount(amount: number) {
  assertSafeMoneyAmount(amount)
  return Math.abs(amount)
}

export function moneySign(amount: number) {
  assertSafeMoneyAmount(amount)
  if (amount === 0) return 0
  return amount > 0 ? 1 : -1
}

// Intl.NumberFormat construction is comparatively expensive and formatMoneyDecimal runs
// per-row per-render in virtualized tables, so memoize the digit count per currency.
const currencyFractionDigitsCache = new Map<string, number>()

function currencyFractionDigits(currency: string) {
  const cached = currencyFractionDigitsCache.get(currency)
  if (cached !== undefined) return cached

  const digits = resolveCurrencyFractionDigits(currency)
  currencyFractionDigitsCache.set(currency, digits)
  return digits
}

function resolveCurrencyFractionDigits(currency: string) {
  try {
    return new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}
