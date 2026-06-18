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
  aiConfidence?: string | null
}

export function buildBankImportLedgerDraft(input: BankImportLedgerDraftInput) {
  const sign = moneySign(input.amount)
  const movementAmount = absoluteMoneyString(input.amount)
  const now = new Date()
  const ledgerTransactionId = crypto.randomUUID()

  return {
    transaction: {
      id: ledgerTransactionId,
      teamId: input.teamId,
      bankTransactionId: input.bankTransactionId,
      source: 'bank_import' as const,
      status: input.status,
      aiConfidence: input.aiConfidence ?? null,
      date: input.date,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    },
    movement: {
      id: crypto.randomUUID(),
      ledgerTransactionId,
      debitAccountId: sign > 0 ? input.bankLedgerAccountId : input.oppositeAccountId,
      creditAccountId: sign > 0 ? input.oppositeAccountId : input.bankLedgerAccountId,
      amount: movementAmount,
      currency: input.currency,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
  }
}

function moneySign(amount: string) {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric) || numeric === 0) {
    throw new Error('Bank transaction amount must be non-zero')
  }
  return numeric > 0 ? 1 : -1
}

function absoluteMoneyString(amount: string) {
  const trimmed = amount.trim()
  if (trimmed.startsWith('-') || trimmed.startsWith('+')) {
    return trimmed.slice(1)
  }
  return trimmed
}
