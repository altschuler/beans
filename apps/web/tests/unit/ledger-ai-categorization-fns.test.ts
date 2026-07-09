import {beforeEach, describe, expect, it, vi} from 'vitest'

const startFlueCategorizeTransactionWorkflow = vi.hoisted(() => vi.fn(async () => ({appRunId: 'flue-app-run-1'})))
const startFlueCategorizeNeedsReviewWorkflow = vi.hoisted(() => vi.fn(async () => ({appRunId: 'flue-app-run-2'})))
const startEveCategorizeTransactionTask = vi.hoisted(() => vi.fn(async () => ({appRunId: 'eve-app-run-1'})))
const startEveCategorizeNeedsReviewTask = vi.hoisted(() => vi.fn(async () => ({appRunId: 'eve-app-run-2'})))

vi.mock('@/ledger/flue-categorization-workflow.server', () => ({
  startFlueCategorizeTransactionWorkflow,
  startFlueCategorizeNeedsReviewWorkflow,
}))

vi.mock('@/ledger/eve-categorization-session.server', () => ({
  startEveCategorizeTransactionTask,
  startEveCategorizeNeedsReviewTask,
}))

describe('AI categorization server function handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('starts a row-constrained Flue categorization workflow for the authenticated user by default', async () => {
    const {runAiCategorizeTransactionForUser} = await import('@/ledger/ai-categorization-fns.server')

    const result = await runAiCategorizeTransactionForUser('user-1', {bankTransactionId: 'bank-transaction-1'})

    expect(startFlueCategorizeTransactionWorkflow).toHaveBeenCalledWith({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})
    expect(result).toEqual({appRunId: 'flue-app-run-1'})
  })

  it('starts an unconstrained Flue batch workflow for the authenticated user without the old batch limit by default', async () => {
    const {runAiCategorizeNeedsReviewBatchForUser} = await import('@/ledger/ai-categorization-fns.server')

    const result = await runAiCategorizeNeedsReviewBatchForUser('user-1', {limit: 100})

    expect(startFlueCategorizeNeedsReviewWorkflow).toHaveBeenCalledWith({userId: 'user-1'})
    expect(result).toEqual({appRunId: 'flue-app-run-2'})
  })

  it('can route authenticated categorization starts to eve for the migration spike', async () => {
    vi.stubEnv('PENGE_AI_RUNTIME', 'eve')
    const {runAiCategorizeTransactionForUser, runAiCategorizeNeedsReviewBatchForUser} = await import('@/ledger/ai-categorization-fns.server')

    await expect(runAiCategorizeTransactionForUser('user-1', {bankTransactionId: 'bank-transaction-1'})).resolves.toEqual({appRunId: 'eve-app-run-1'})
    await expect(runAiCategorizeNeedsReviewBatchForUser('user-1')).resolves.toEqual({appRunId: 'eve-app-run-2'})

    expect(startEveCategorizeTransactionTask).toHaveBeenCalledWith({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})
    expect(startEveCategorizeNeedsReviewTask).toHaveBeenCalledWith({userId: 'user-1'})
    expect(startFlueCategorizeTransactionWorkflow).not.toHaveBeenCalled()
    expect(startFlueCategorizeNeedsReviewWorkflow).not.toHaveBeenCalled()
  })
})
