import {beforeEach, describe, expect, it, vi} from 'vitest'

const aiCategorizeBankTransactions = vi.hoisted(() =>
  vi.fn(async () => ({requested: 1, suggested: 1, applied: 1, confirmed: 1, stillNeedsReview: 0, skipped: 0})),
)

vi.mock('@/ledger/ai-categorization.server', () => ({aiCategorizeBankTransactions}))

describe('AI categorization server function handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs single bank transaction categorization for the authenticated user', async () => {
    const {runAiCategorizeTransactionForUser} = await import('@/ledger/ai-categorization-fns.server')

    const result = await runAiCategorizeTransactionForUser('user-1', {bankTransactionId: 'bank-transaction-1'})

    expect(aiCategorizeBankTransactions).toHaveBeenCalledWith({userId: 'user-1', bankTransactionIds: ['bank-transaction-1']})
    expect(result).toEqual({requested: 1, suggested: 1, applied: 1, confirmed: 1, stillNeedsReview: 0, skipped: 0})
  })

  it('runs capped batch categorization for the authenticated user', async () => {
    const {runAiCategorizeNeedsReviewBatchForUser} = await import('@/ledger/ai-categorization-fns.server')

    await runAiCategorizeNeedsReviewBatchForUser('user-1', {limit: 100})

    expect(aiCategorizeBankTransactions).toHaveBeenCalledWith({userId: 'user-1', limit: 100})
  })
})
