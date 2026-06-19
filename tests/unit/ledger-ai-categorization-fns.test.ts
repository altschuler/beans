import {beforeEach, describe, expect, it, vi} from 'vitest'

const aiCategorizeLedgerTransactions = vi.hoisted(() =>
  vi.fn(async () => ({requested: 1, suggested: 1, applied: 1, confirmed: 1, stillNeedsReview: 0, skipped: 0})),
)

vi.mock('@/ledger/ai-categorization.server', () => ({aiCategorizeLedgerTransactions}))

describe('AI categorization server function handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs single transaction categorization for the authenticated user', async () => {
    const {runAiCategorizeTransactionForUser} = await import('@/ledger/ai-categorization-fns.server')

    const result = await runAiCategorizeTransactionForUser('user-1', {ledgerTransactionId: 'ledger-transaction-1'})

    expect(aiCategorizeLedgerTransactions).toHaveBeenCalledWith({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']})
    expect(result).toEqual({requested: 1, suggested: 1, applied: 1, confirmed: 1, stillNeedsReview: 0, skipped: 0})
  })

  it('runs capped batch categorization for the authenticated user', async () => {
    const {runAiCategorizeNeedsReviewBatchForUser} = await import('@/ledger/ai-categorization-fns.server')

    await runAiCategorizeNeedsReviewBatchForUser('user-1', {limit: 100})

    expect(aiCategorizeLedgerTransactions).toHaveBeenCalledWith({userId: 'user-1', limit: 100})
  })
})
