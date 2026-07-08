import {createServerFn} from '@tanstack/react-start'
import {z} from 'zod'

const aiCategorizeTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
})

const aiCategorizeNeedsReviewBatchInput = z.object({
  limit: z.number().int().positive().optional(),
})

const reconcileAiCategorizationWorkflowsInput = z.object({
  teamId: z.string().min(1),
})

export const aiCategorizeTransaction = createServerFn({method: 'POST'})
  .validator((data: unknown) => aiCategorizeTransactionInput.parse(data))
  .handler(async ({data}) => {
    const {ensureSession} = await import('@/auth/session')
    const {runAiCategorizeTransactionForUser} = await import('./ai-categorization-fns.server')
    const session = await ensureSession()
    return runAiCategorizeTransactionForUser(session.user.id, data)
  })

export const aiCategorizeNeedsReviewBatch = createServerFn({method: 'POST'})
  .validator((data: unknown) => aiCategorizeNeedsReviewBatchInput.parse(data))
  .handler(async ({data}) => {
    const {ensureSession} = await import('@/auth/session')
    const {runAiCategorizeNeedsReviewBatchForUser} = await import('./ai-categorization-fns.server')
    const session = await ensureSession()
    return runAiCategorizeNeedsReviewBatchForUser(session.user.id, data)
  })

export const reconcileAiCategorizationWorkflows = createServerFn({method: 'POST'})
  .validator((data: unknown) => reconcileAiCategorizationWorkflowsInput.parse(data))
  .handler(async ({data}) => {
    const {ensureSession} = await import('@/auth/session')
    const {reconcileCategorizationWorkflowRunsForUser} = await import('./flue-categorization-workflow.server')
    const session = await ensureSession()
    await reconcileCategorizationWorkflowRunsForUser({userId: session.user.id, teamId: data.teamId})
  })
