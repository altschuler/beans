import {beforeEach, describe, expect, it, vi} from 'vitest'

const startFlueCategorizeTransactionWorkflow = vi.hoisted(() => vi.fn(async () => ({appRunId: 'app-run-1'})))
const startFlueCategorizeNeedsReviewWorkflow = vi.hoisted(() => vi.fn(async () => ({appRunId: 'app-run-2'})))

vi.mock('@/ledger/flue-categorization-workflow.server', () => ({
  startFlueCategorizeTransactionWorkflow,
  startFlueCategorizeNeedsReviewWorkflow,
}))

describe('AI categorization server function handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a row-constrained Flue categorization workflow for the authenticated user', async () => {
    const {runAiCategorizeTransactionForUser} = await import('@/ledger/ai-categorization-fns.server')

    const result = await runAiCategorizeTransactionForUser('user-1', {bankTransactionId: 'bank-transaction-1'})

    expect(startFlueCategorizeTransactionWorkflow).toHaveBeenCalledWith({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})
    expect(result).toEqual({appRunId: 'app-run-1'})
  })

  it('starts an unconstrained Flue batch workflow for the authenticated user without the old batch limit', async () => {
    const {runAiCategorizeNeedsReviewBatchForUser} = await import('@/ledger/ai-categorization-fns.server')

    const result = await runAiCategorizeNeedsReviewBatchForUser('user-1', {limit: 100})

    expect(startFlueCategorizeNeedsReviewWorkflow).toHaveBeenCalledWith({userId: 'user-1'})
    expect(result).toEqual({appRunId: 'app-run-2'})
  })
})
