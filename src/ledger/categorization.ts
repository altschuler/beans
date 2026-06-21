export type CategorizationLineInput = {
  accountId: string
  amount: string
}

export type BankLinkedCategorizationLinesInput = {
  bankAmount: string
  lines: CategorizationLineInput[]
}

export type LedgerPostingInput = {
  id?: string
  ledgerTransactionId: string
  accountId: string
  amount: string
  currency: string
  bankTransactionId?: string | null
  sortOrder?: number
  now?: Date
}

export type BuiltLedgerPosting = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: string
  currency: string
  bankTransactionId: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type ReconciledBankPosting = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: string
  currency: string
  bankTransactionId: string
}

export type BankTransactionPostingSource = {
  bankTransactionId: string
  bankLedgerAccountId: string
  amount: string
  currency: string
}

export type BankTransactionInterpretationInput = {
  ledgerTransactionId: string
  source: BankTransactionPostingSource
  lines: CategorizationLineInput[]
  now?: Date
}

export type BankTransactionTransferInput = {
  ledgerTransactionId: string
  source: BankTransactionPostingSource
  targetLedgerAccountId: string
  counterBankTransactionId: string
  now?: Date
}

export type BalanceAccount = {
  id: string
  normalBalance: string
}

export type BalancePosting = {
  accountId: string
  amount: string
  currency?: string | null
}

export type CategorizationAccountCandidate = {
  type: string
  status: string
  systemKey?: string | null
  linkedBankAccountId?: string | null
}

const MONEY_SCALE = 4n
const MONEY_FACTOR = 10_000n
const REAL_CATEGORIZATION_ACCOUNT_TYPES = new Set(['income', 'expense', 'savings'])

export function validateBankLinkedCategorizationLines(input: BankLinkedCategorizationLinesInput) {
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

  return {bankAmountUnits, lineUnits}
}

export function buildBankLinkedCategorizationPostings(input: {
  bankPosting: ReconciledBankPosting
  lines: CategorizationLineInput[]
  now?: Date
}): BuiltLedgerPosting[] {
  const {bankAmountUnits, lineUnits} = validateBankLinkedCategorizationLines({
    bankAmount: input.bankPosting.amount,
    lines: input.lines,
  })
  const now = input.now ?? new Date()
  const explanatorySign = bankAmountUnits > 0n ? -1n : 1n
  const bankPosting: BuiltLedgerPosting = {
    id: input.bankPosting.id,
    ledgerTransactionId: input.bankPosting.ledgerTransactionId,
    accountId: input.bankPosting.accountId,
    amount: formatScaledUnits(bankAmountUnits),
    currency: input.bankPosting.currency,
    bankTransactionId: input.bankPosting.bankTransactionId,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }

  const explanatoryPostings = input.lines.map((line, index) => ({
    id: crypto.randomUUID(),
    ledgerTransactionId: input.bankPosting.ledgerTransactionId,
    accountId: line.accountId,
    amount: formatScaledUnits((lineUnits[index] ?? 0n) * explanatorySign),
    currency: input.bankPosting.currency,
    bankTransactionId: null,
    sortOrder: index + 1,
    createdAt: now,
    updatedAt: now,
  }))

  const postings = [bankPosting, ...explanatoryPostings]
  validateLedgerPostingsBalance(postings)
  return postings
}

export function buildBankTransactionCategorizationPostings(input: BankTransactionInterpretationInput): BuiltLedgerPosting[] {
  const sourceAmountUnits = parseMoneyToScaledUnits(input.source.amount)
  if (sourceAmountUnits === 0n) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const {lineUnits} = validateBankLinkedCategorizationLines({
    bankAmount: input.source.amount,
    lines: input.lines,
  })
  const now = input.now ?? new Date()
  const explanatorySign = sourceAmountUnits > 0n ? -1n : 1n
  const postings: BuiltLedgerPosting[] = [
    {
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: input.source.bankLedgerAccountId,
      amount: formatScaledUnits(sourceAmountUnits),
      currency: input.source.currency,
      bankTransactionId: input.source.bankTransactionId,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    ...input.lines.map((line, index) => ({
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: line.accountId,
      amount: formatScaledUnits((lineUnits[index] ?? 0n) * explanatorySign),
      currency: input.source.currency,
      bankTransactionId: null,
      sortOrder: index + 1,
      createdAt: now,
      updatedAt: now,
    })),
  ]

  validateLedgerPostingsBalance(postings)
  return postings
}

export function buildBankTransactionTransferPostings(input: BankTransactionTransferInput): BuiltLedgerPosting[] {
  const sourceAmountUnits = parseMoneyToScaledUnits(input.source.amount)
  if (sourceAmountUnits === 0n) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const now = input.now ?? new Date()
  const postings: BuiltLedgerPosting[] = [
    {
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: input.source.bankLedgerAccountId,
      amount: formatScaledUnits(sourceAmountUnits),
      currency: input.source.currency,
      bankTransactionId: input.source.bankTransactionId,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: input.targetLedgerAccountId,
      amount: formatScaledUnits(-sourceAmountUnits),
      currency: input.source.currency,
      bankTransactionId: input.counterBankTransactionId,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]

  validateLedgerPostingsBalance(postings)
  return postings
}

export function validateLedgerPostingsBalance(postings: Array<{amount: string; currency: string}>) {
  if (postings.length < 2) {
    throw new Error('Ledger transaction must have at least two postings')
  }

  const totalsByCurrency = new Map<string, bigint>()
  for (const posting of postings) {
    const amount = parseMoneyToScaledUnits(posting.amount)
    if (amount === 0n) {
      throw new Error('Ledger postings must be non-zero')
    }
    totalsByCurrency.set(posting.currency, (totalsByCurrency.get(posting.currency) ?? 0n) + amount)
  }

  if ([...totalsByCurrency.values()].some(total => total !== 0n)) {
    throw new Error('Ledger postings must balance to zero per currency')
  }
}

export function deriveLedgerAccountBalances(accounts: BalanceAccount[], postings: BalancePosting[]) {
  const balancesByAccount = new Map(accounts.map(account => [account.id, new Map<string, bigint>()]))
  const normalBalances = new Map(accounts.map(account => [account.id, account.normalBalance]))

  for (const posting of postings) {
    const normalBalance = normalBalances.get(posting.accountId)
    const accountBalances = balancesByAccount.get(posting.accountId)
    if (!normalBalance || !accountBalances) continue
    const currency = posting.currency ?? ''
    const amount = parseMoneyToScaledUnits(posting.amount)
    const displayAmount = normalBalance === 'credit' ? -amount : amount
    accountBalances.set(currency, (accountBalances.get(currency) ?? 0n) + displayAmount)
  }

  return new Map(
    [...balancesByAccount.entries()].map(([accountId, balancesByCurrency]) => {
      const nonZeroBalances = [...balancesByCurrency.values()].filter(balance => balance !== 0n)
      if (nonZeroBalances.length === 0) return [accountId, '0.0000']
      if (nonZeroBalances.length > 1) return [accountId, 'Multiple currencies']
      return [accountId, formatScaledUnits(nonZeroBalances[0]!)]
    }),
  )
}

export function isRealCategorizationAccount(account: CategorizationAccountCandidate) {
  return (
    account.status === 'active' &&
    account.systemKey == null &&
    account.linkedBankAccountId == null &&
    REAL_CATEGORIZATION_ACCOUNT_TYPES.has(account.type)
  )
}

export function isCategorizationAccount(account: CategorizationAccountCandidate) {
  return isRealCategorizationAccount(account)
}

export function parseMoneyToScaledUnits(value: string) {
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

export function formatScaledUnits(value: bigint) {
  const sign = value < 0n ? '-' : ''
  const absolute = absoluteBigInt(value)
  const whole = absolute / MONEY_FACTOR
  const fractional = (absolute % MONEY_FACTOR).toString().padStart(Number(MONEY_SCALE), '0')
  return `${sign}${whole}.${fractional}`
}

function absoluteBigInt(value: bigint) {
  return value < 0n ? -value : value
}
