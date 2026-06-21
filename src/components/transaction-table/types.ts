export type SplitLine = {accountId: string; amount: string}

export type CategorizationAccountOption = {id: string; name: string}

export type TransferAccountOption = {id: string; bankAccountId: string; name: string}

export type CategorySelection = {kind: 'category'; accountId: string} | {kind: 'transfer'; accountId: string}

export type TransactionTableStatusIndicator = {
  kind: 'processing' | 'uncategorized' | 'confirmed' | 'ai_confident' | 'needs_review' | 'ai_failed'
  title: string
  ariaLabel: string
  className: string
  canConfirm: boolean
}

export type TransactionTableRow = {
  id: string
  ledgerTransactionId: string | null
  bankTransactionId: string
  bankAccountId: string | null
  description: string
  date: string | null
  bankAccountName: string
  amount: string
  currency: string
  status: string
  needsReview: boolean
  aiConfidence: number | null
  aiProcessing: boolean
  canCategorize: boolean
  statusIndicator: TransactionTableStatusIndicator
  aiIndicator: TransactionTableStatusIndicator
  categoryAccountId: string | null
  categoryLabel: string
  isSplit: boolean
  splitLines: SplitLine[]
}
