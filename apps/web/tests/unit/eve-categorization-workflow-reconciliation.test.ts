import {describe, expect, it, vi} from 'vitest'
import {AgentWorkflowRunNotFoundError} from '@penge/domain/workflow-runs'
import {createEveCategorizationWorkflowRunReconciler} from '@/ledger/eve-categorization-reconciliation.server'

const now = new Date('2026-07-10T12:00:00.000Z')
const staleRun = {
  id: 'app-run-1',
  teamId: 'team-1',
  requestedByUserId: 'user-1',
  eveSessionId: 'eve-session-1',
  eveNextStreamIndex: 3,
  updatedAt: new Date('2026-07-10T11:50:00.000Z'),
}

type ReadEventsResult = {status: 'found' | 'missing'; events: Record<string, unknown>[]}

function dependencies() {
  return {
    now: () => now,
    failStalePendingWorkflowRuns: vi.fn(async () => undefined),
    listRunningWorkflowRuns: vi.fn(async () => [staleRun]),
    readEveEvents: vi.fn(async (_input: typeof staleRun & {startIndex: number}): Promise<ReadEventsResult> => ({
      status: 'found', events: [{type: 'session.completed'}],
    })),
    advanceEveCursor: vi.fn(async () => undefined),
    markWorkflowRunCompleted: vi.fn(async () => undefined),
    markWorkflowRunFailed: vi.fn(async () => undefined),
  }
}

describe('eve categorization workflow reconciliation', () => {
  it('reaps stale pending runs before reconciling durable running streams', async () => {
    const deps = dependencies()
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.failStalePendingWorkflowRuns).toHaveBeenCalledWith({
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      staleBefore: new Date('2026-07-10T11:55:00.000Z'),
    })
    expect(deps.readEveEvents).toHaveBeenCalledWith({...staleRun, startIndex: 3})
    expect(deps.markWorkflowRunCompleted).toHaveBeenCalledWith({id: 'app-run-1'})
    expect(deps.advanceEveCursor).not.toHaveBeenCalled()
  })

  it('advances the cursor after non-terminal events', async () => {
    const deps = dependencies()
    deps.readEveEvents.mockResolvedValue({status: 'found', events: [{type: 'actions.requested'}]})
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.advanceEveCursor).toHaveBeenCalledWith({
      id: 'app-run-1', eveSessionId: 'eve-session-1', eveNextStreamIndex: 4,
    })
    expect(deps.markWorkflowRunCompleted).not.toHaveBeenCalled()
  })

  it('maps sanitized Eve failure boundaries to a display-safe failed run', async () => {
    const deps = dependencies()
    deps.readEveEvents.mockResolvedValue({
      status: 'found',
      events: [{type: 'session.failed', data: {code: 'CHAT_RUNTIME_FAILED', message: 'The assistant could not complete this request.'}}],
    })
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.markWorkflowRunFailed).toHaveBeenCalledWith({
      id: 'app-run-1', error: 'The assistant could not complete this request.',
    })
  })

  it('fails a run when Eve no longer has the mapped session', async () => {
    const deps = dependencies()
    deps.readEveEvents.mockResolvedValue({status: 'missing', events: []})
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.markWorkflowRunFailed).toHaveBeenCalledWith({id: 'app-run-1', error: 'AI categorization run could not be found'})
    expect(deps.advanceEveCursor).not.toHaveBeenCalled()
  })

  it('continues reconciling other runs when one Eve stream fails', async () => {
    const deps = dependencies()
    const secondRun = {...staleRun, id: 'app-run-2', eveSessionId: 'eve-session-2'}
    deps.listRunningWorkflowRuns.mockResolvedValue([staleRun, secondRun])
    deps.readEveEvents.mockImplementation(async run => {
      if (run.id === staleRun.id) throw new Error('temporary Eve failure')
      return {status: 'found', events: [{type: 'session.completed'}]}
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await expect(reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})).resolves.toBeUndefined()

    expect(deps.markWorkflowRunCompleted).toHaveBeenCalledWith({id: 'app-run-2'})
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('treats a cursor race with the terminal fast path as benign', async () => {
    const deps = dependencies()
    deps.readEveEvents.mockResolvedValue({status: 'found', events: [{type: 'actions.requested'}]})
    deps.advanceEveCursor.mockRejectedValue(new AgentWorkflowRunNotFoundError(staleRun.id))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await expect(reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})).resolves.toBeUndefined()

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('skips fresh running sessions and is safe to repeat after terminal convergence', async () => {
    const deps = dependencies()
    deps.listRunningWorkflowRuns
      .mockResolvedValueOnce([{...staleRun, updatedAt: new Date('2026-07-10T11:59:00.000Z')}])
      .mockResolvedValueOnce([])
    const reconciler = createEveCategorizationWorkflowRunReconciler(deps)

    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})
    await reconciler.reconcile({teamId: 'team-1', workflowName: 'categorize-transactions'})

    expect(deps.readEveEvents).not.toHaveBeenCalled()
    expect(deps.markWorkflowRunCompleted).not.toHaveBeenCalled()
  })
})
