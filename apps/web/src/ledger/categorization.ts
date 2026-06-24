import {sum} from 'lodash-es'
import {absoluteMoneyAmount, assertSafeMoneyAmount, parseDecimalMoneyToAmount} from '@/lib/money'

export type CategorizationLineInput = {
  accountId: string
  amount: string
}

export type BankLinkedCategorizationLinesInput = {
  bankAmount: number
  lines: CategorizationLineInput[]
}

export type LedgerPostingInput = {
  id?: string
  ledgerTransactionId: string
  accountId: string
  amount: number
  currency: string
  bankTransactionId?: string | null
  sortOrder?: number
  now?: Date
}

export type BuiltLedgerPosting = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: number
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
  amount: number
  currency: string
  bankTransactionId: string
}

export type BankTransactionPostingSource = {
  bankTransactionId: string
  bankLedgerAccountId: string
  amount: number
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
  amount: number
  currency?: string | null
}

export type CategorizationAccountCandidate = {
  type: string
  status: string
  systemKey?: string | null
  linkedBankAccountId?: string | null
}

const REAL_CATEGORIZATION_ACCOUNT_TYPES = new Set(['income', 'expense', 'savings'])

export function validateBankLinkedCategorizationLines(input: BankLinkedCategorizationLinesInput) {
  if (input.lines.length === 0) {
    throw new Error('At least one categorization line is required')
  }

  const bankAmountUnits = input.bankAmount
  assertSafeMoneyAmount(bankAmountUnits)
  if (bankAmountUnits === 0) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const expectedTotal = absoluteMoneyAmount(bankAmountUnits)
  const lineUnits = input.lines.map(line => parseDecimalMoneyToAmount(line.amount))

  if (lineUnits.some(amount => amount <= 0)) {
    throw new Error('Split amounts must be positive')
  }

  const actualTotal = sum(lineUnits)
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
  const explanatorySign = bankAmountUnits > 0 ? -1 : 1
  const bankPosting: BuiltLedgerPosting = {
    id: input.bankPosting.id,
    ledgerTransactionId: input.bankPosting.ledgerTransactionId,
    accountId: input.bankPosting.accountId,
    amount: bankAmountUnits,
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
    amount: (lineUnits[index] ?? 0) * explanatorySign,
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
  const sourceAmountUnits = input.source.amount
  assertSafeMoneyAmount(sourceAmountUnits)
  if (sourceAmountUnits === 0) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const {lineUnits} = validateBankLinkedCategorizationLines({
    bankAmount: input.source.amount,
    lines: input.lines,
  })
  const now = input.now ?? new Date()
  const explanatorySign = sourceAmountUnits > 0 ? -1 : 1
  const postings: BuiltLedgerPosting[] = [
    {
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: input.source.bankLedgerAccountId,
      amount: sourceAmountUnits,
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
      amount: (lineUnits[index] ?? 0) * explanatorySign,
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
  const sourceAmountUnits = input.source.amount
  assertSafeMoneyAmount(sourceAmountUnits)
  if (sourceAmountUnits === 0) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const now = input.now ?? new Date()
  const postings: BuiltLedgerPosting[] = [
    {
      id: crypto.randomUUID(),
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: input.source.bankLedgerAccountId,
      amount: sourceAmountUnits,
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
      amount: -sourceAmountUnits,
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

export function validateLedgerPostingsBalance(postings: Array<{amount: number; currency: string}>) {
  if (postings.length < 2) {
    throw new Error('Ledger transaction must have at least two postings')
  }

  const totalsByCurrency = new Map<string, number>()
  for (const posting of postings) {
    assertSafeMoneyAmount(posting.amount)
    if (posting.amount === 0) {
      throw new Error('Ledger postings must be non-zero')
    }
    totalsByCurrency.set(posting.currency, (totalsByCurrency.get(posting.currency) ?? 0) + posting.amount)
  }

  if ([...totalsByCurrency.values()].some(total => total !== 0)) {
    throw new Error('Ledger postings must balance to zero per currency')
  }
}

export function deriveLedgerAccountBalances(accounts: BalanceAccount[], postings: BalancePosting[]): Map<string, number | 'Multiple currencies'> {
  const balancesByAccount = new Map(accounts.map(account => [account.id, new Map<string, number>()]))
  const normalBalances = new Map(accounts.map(account => [account.id, account.normalBalance]))

  for (const posting of postings) {
    const normalBalance = normalBalances.get(posting.accountId)
    const accountBalances = balancesByAccount.get(posting.accountId)
    if (!normalBalance || !accountBalances) continue
    const currency = posting.currency ?? ''
    assertSafeMoneyAmount(posting.amount)
    const displayAmount = normalBalance === 'credit' ? -posting.amount : posting.amount
    accountBalances.set(currency, (accountBalances.get(currency) ?? 0) + displayAmount)
  }

  return new Map<string, number | 'Multiple currencies'>(
    [...balancesByAccount.entries()].map(([accountId, balancesByCurrency]) => {
      const nonZeroBalances = [...balancesByCurrency.values()].filter(balance => balance !== 0)
      if (nonZeroBalances.length === 0) return [accountId, 0] as const
      if (nonZeroBalances.length > 1) return [accountId, 'Multiple currencies'] as const
      return [accountId, nonZeroBalances[0]!] as const
    }),
  )
}

// Picks the single currency to display an account balance in: the lone currency with a
// non-zero net, or (when everything nets to zero) the lone currency seen at all. Returns
// null when the account mixes currencies or has no postings.
export function deriveSingleBalanceCurrency(accountId: string, postings: Array<{accountId: string; amount: number; currency: string}>) {
  const totalsByCurrency = new Map<string, number>()
  for (const posting of postings) {
    if (posting.accountId !== accountId) continue
    totalsByCurrency.set(posting.currency, (totalsByCurrency.get(posting.currency) ?? 0) + posting.amount)
  }

  const nonZeroCurrencies = [...totalsByCurrency.entries()].filter(([, amount]) => amount !== 0).map(([currency]) => currency)
  if (nonZeroCurrencies.length === 1) return nonZeroCurrencies[0]!
  if (nonZeroCurrencies.length > 1) return null

  const allCurrencies = [...totalsByCurrency.keys()]
  return allCurrencies.length === 1 ? allCurrencies[0]! : null
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

