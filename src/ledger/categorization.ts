export type CategorizationLineInput = {
  accountId: string
  amount: string
}

export type BankLinkedCategorizationMovementInput = {
  ledgerTransactionId: string
  bankLedgerAccountId: string
  bankAmount: string
  currency: string
  lines: CategorizationLineInput[]
  now?: Date
}

export type BuiltLedgerMovement = {
  id: string
  ledgerTransactionId: string
  debitAccountId: string
  creditAccountId: string
  amount: string
  currency: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type BalanceAccount = {
  id: string
  normalBalance: string
}

export type BalanceMovement = {
  debitAccountId: string
  creditAccountId: string
  amount: string
}

export type CategorizationAccountCandidate = {
  type: string
  status: string
}

const MONEY_SCALE = 4n
const MONEY_FACTOR = 10_000n

export function buildBankLinkedCategorizationMovements(input: BankLinkedCategorizationMovementInput): BuiltLedgerMovement[] {
  if (input.lines.length === 0) {
    throw new Error('At least one categorization line is required')
  }

  const bankAmountUnits = parseMoneyToScaledUnits(input.bankAmount)
  if (bankAmountUnits === 0n) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const expectedTotal = absoluteBigInt(bankAmountUnits)
  const lineUnits = input.lines.map(line => parseMoneyToScaledUnits(line.amount))

  if (lineUnits.some(amount => amount <= 0n)) {
    throw new Error('Split amounts must be positive')
  }

  const actualTotal = lineUnits.reduce((total, amount) => total + amount, 0n)
  if (actualTotal !== expectedTotal) {
    throw new Error('Split total must equal the bank transaction amount')
  }

  const now = input.now ?? new Date()
  return input.lines.map((line, sortOrder) => {
    const amount = formatScaledUnits(lineUnits[sortOrder] ?? 0n)
    const bankAmountIsPositive = bankAmountUnits > 0n

    return {
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      debitAccountId: bankAmountIsPositive ? input.bankLedgerAccountId : line.accountId,
      creditAccountId: bankAmountIsPositive ? line.accountId : input.bankLedgerAccountId,
      amount,
      currency: input.currency,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    }
  })
}

export function isCategorizationAccount(account: CategorizationAccountCandidate) {
  return account.status === 'active' && account.type !== 'bank'
}

export function deriveLedgerAccountBalances(accounts: BalanceAccount[], movements: BalanceMovement[]) {
  const balances = new Map(accounts.map(account => [account.id, 0n]))
  const normalBalances = new Map(accounts.map(account => [account.id, account.normalBalance]))

  for (const movement of movements) {
    const amount = parseMoneyToScaledUnits(movement.amount)
    applyMovementAmount(balances, normalBalances, movement.debitAccountId, amount, 'debit')
    applyMovementAmount(balances, normalBalances, movement.creditAccountId, amount, 'credit')
  }

  return new Map([...balances.entries()].map(([accountId, balance]) => [accountId, formatScaledUnits(balance)]))
}

function applyMovementAmount(
  balances: Map<string, bigint>,
  normalBalances: Map<string, string>,
  accountId: string,
  amount: bigint,
  side: 'debit' | 'credit',
) {
  const normalBalance = normalBalances.get(accountId)
  if (!normalBalance) return

  const current = balances.get(accountId) ?? 0n
  const increases = normalBalance === side
  balances.set(accountId, increases ? current + amount : current - amount)
}

function parseMoneyToScaledUnits(value: string) {
  const trimmed = value.trim()
  const sign = trimmed.startsWith('-') ? -1n : 1n
  const unsigned = trimmed.replace(/^[+-]/, '')
  const [wholePart = '', fractionalPart = ''] = unsigned.split('.')

  if (!/^\d+$/.test(wholePart || '0') || !/^\d*$/.test(fractionalPart) || fractionalPart.length > Number(MONEY_SCALE)) {
    throw new Error('Invalid money amount')
  }

  const paddedFraction = fractionalPart.padEnd(Number(MONEY_SCALE), '0')
  return sign * (BigInt(wholePart || '0') * MONEY_FACTOR + BigInt(paddedFraction || '0'))
}

function formatScaledUnits(value: bigint) {
  const sign = value < 0n ? '-' : ''
  const absolute = absoluteBigInt(value)
  const whole = absolute / MONEY_FACTOR
  const fractional = (absolute % MONEY_FACTOR).toString().padStart(Number(MONEY_SCALE), '0')
  return `${sign}${whole}.${fractional}`
}

function absoluteBigInt(value: bigint) {
  return value < 0n ? -value : value
}
