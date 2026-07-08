import {describe, expect, it, vi} from 'vitest'
import {createFlueCategorizationWorkflowRunReconciler} from '@/ledger/flue-categorization-workflow.server'

const now = new Date('2026-07-08T10:10:00.000Z')
const staleRunUpdatedAt = new Date('2026-07-08T10:00:00.000Z')

function defaultDeps() {
  return {
    now: () => now,
    failStalePreparingWorkflowRuns: vi.fn(async () => []),
    listActiveWorkflowRuns: vi.fn(async () => [] as Array<{id: string; flueRunId: string | null; updatedAt: Date}>),
    getFlueRun: vi.fn(async (_input: {flueRunId: string}) => null as null | {status: 'active' | 'completed' | 'errored'; error?: unknown}),
    getFlueEvents: vi.fn(async (_input: {flueRunId: string}) => [] as unknown[]),
    markWorkflowRunCompletedByFlueRunId: vi.fn(async () => undefined),
    markWorkflowRunFailedByFlueRunId: vi.fn(async () => undefined),
  }
}

describe('Flue categorization workflow reconciliation', () => {
  it('fails Flue-admitted active runs that never emitted workflow events after the stale window', async () => {
    const deps = defaultDeps()
    deps.listActiveWorkflowRuns.mockResolvedValue([{id: 'app-run-1', flueRunId: 'flue-run-1', updatedAt: staleRunUpdatedAt}])
    deps.getFlueRun.mockResolvedValue({status: 'active'})
    deps.getFlueEvents.mockResolvedValue([])
    const reconciler = createFlueCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.failStalePreparingWorkflowRuns).toHaveBeenCalledWith({
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      staleBefore: new Date('2026-07-08T10:05:00.000Z'),
    })
    expect(deps.markWorkflowRunFailedByFlueRunId).toHaveBeenCalledWith({
      flueRunId: 'flue-run-1',
      error: 'Flue admitted workflow but it never started',
    })
  })

  it('keeps active Flue runs that have emitted events', async () => {
    const deps = defaultDeps()
    deps.listActiveWorkflowRuns.mockResolvedValue([{id: 'app-run-1', flueRunId: 'flue-run-1', updatedAt: staleRunUpdatedAt}])
    deps.getFlueRun.mockResolvedValue({status: 'active'})
    deps.getFlueEvents.mockResolvedValue([{type: 'run_start'}])
    const reconciler = createFlueCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.markWorkflowRunFailedByFlueRunId).not.toHaveBeenCalled()
  })

  it('mirrors terminal Flue run state into the app workflow row', async () => {
    const deps = defaultDeps()
    deps.listActiveWorkflowRuns.mockResolvedValue([
      {id: 'app-run-1', flueRunId: 'flue-run-completed', updatedAt: staleRunUpdatedAt},
      {id: 'app-run-2', flueRunId: 'flue-run-errored', updatedAt: staleRunUpdatedAt},
    ])
    deps.getFlueRun.mockImplementation(async ({flueRunId}: {flueRunId: string}) => {
      if (flueRunId === 'flue-run-completed') return {status: 'completed'}
      return {status: 'errored', error: {message: 'provider unavailable'}}
    })
    const reconciler = createFlueCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.markWorkflowRunCompletedByFlueRunId).toHaveBeenCalledWith({flueRunId: 'flue-run-completed'})
    expect(deps.markWorkflowRunFailedByFlueRunId).toHaveBeenCalledWith({flueRunId: 'flue-run-errored', error: 'provider unavailable'})
  })

  it('fails stale app rows whose Flue run disappeared', async () => {
    const deps = defaultDeps()
    deps.listActiveWorkflowRuns.mockResolvedValue([{id: 'app-run-1', flueRunId: 'missing-run', updatedAt: staleRunUpdatedAt}])
    deps.getFlueRun.mockResolvedValue(null)
    const reconciler = createFlueCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.markWorkflowRunFailedByFlueRunId).toHaveBeenCalledWith({
      flueRunId: 'missing-run',
      error: 'Flue workflow run could not be found',
    })
  })
})
