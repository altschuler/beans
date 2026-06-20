import {formatScaledUnits, parseMoneyToScaledUnits, validateLedgerPostingsBalance} from './categorization'

export type LedgerTransactionStatus = 'confirmed' | 'needs_review'
export type LedgerTransactionSource = 'bank_import' | 'manual' | 'opening_balance' | 'budgeting'

export type BankImportLedgerDraftInput = {
  teamId: string
  bankTransactionId: string
  bankLedgerAccountId: string
  oppositeAccountId: string
  amount: string
  currency: string
  description: string
  date: string | null
  status: LedgerTransactionStatus
  aiConfidence?: 0 | 1 | 2 | null
  categorizedBy?: 'user' | 'ai' | null
}

export function buildBankImportLedgerDraft(input: BankImportLedgerDraftInput) {
  const amountUnits = parseMoneyToScaledUnits(input.amount)
  if (amountUnits === 0n) {
    throw new Error('Bank transaction amount must be non-zero')
  }

  const now = new Date()
  const ledgerTransactionId = crypto.randomUUID()
  const postings = [
    {
      id: crypto.randomUUID(),
      ledgerTransactionId,
      accountId: input.bankLedgerAccountId,
      amount: formatScaledUnits(amountUnits),
      currency: input.currency,
      bankTransactionId: input.bankTransactionId,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      ledgerTransactionId,
      accountId: input.oppositeAccountId,
      amount: formatScaledUnits(-amountUnits),
      currency: input.currency,
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]
  validateLedgerPostingsBalance(postings)

  return {
    transaction: {
      id: ledgerTransactionId,
      teamId: input.teamId,
      source: 'bank_import' as const,
      status: input.status,
      aiConfidence: input.aiConfidence ?? null,
      aiProcessingStartedAt: null,
      categorizedBy: input.categorizedBy ?? null,
      userConfirmedAt: null,
      userConfirmedBy: null,
      aiReasoning: null,
      date: input.date,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    },
    postings,
  }
}
