import {beforeEach, describe, expect, it, vi} from 'vitest'
import {ActiveWorkflowRunExistsError} from '@penge/domain/workflow-runs'

const defaultDeps = () => {
  const reservedRuns: Array<{workflowName: string; teamId: string; requestedByUserId: string}> = []
  return {
    resolveBankTransactionTeamId: vi.fn(async () => 'team-1'),
    resolveCurrentTeamId: vi.fn(async () => 'team-1'),
    reserveWorkflowRun: vi.fn(async (input: {workflowName: string; teamId: string; requestedByUserId: string}) => {
      reservedRuns.push(input)
      return {id: 'app-run-1'}
    }),
    invokeFlueWorkflow: vi.fn(async () => ({runId: 'flue-run-1'})),
    markWorkflowRunFailed: vi.fn(async () => undefined),
    reservedRuns,
  }
}

describe('Flue categorization web workflow starter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reserves an app workflow run and starts Flue for a row-constrained transaction', async () => {
    const deps = defaultDeps()
    const {createFlueCategorizationWorkflowStarter} = await import('@/ledger/flue-categorization-workflow.server')
    const starter = createFlueCategorizationWorkflowStarter(deps)

    const result = await starter.startTransaction({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})

    expect(result).toEqual({appRunId: 'app-run-1'})
    expect(deps.resolveBankTransactionTeamId).toHaveBeenCalledWith({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})
    expect(deps.reserveWorkflowRun).toHaveBeenCalledWith({
      workflowName: 'categorize-transactions',
      teamId: 'team-1',
      requestedByUserId: 'user-1',
    })
    expect(deps.invokeFlueWorkflow).toHaveBeenCalledWith({
      appRunId: 'app-run-1',
      userId: 'user-1',
      teamId: 'team-1',
      targetBankTransactionIds: ['bank-transaction-1'],
    })
  })

  it('reserves an app workflow run and starts Flue for the current team batch without target ids', async () => {
    const deps = defaultDeps()
    const {createFlueCategorizationWorkflowStarter} = await import('@/ledger/flue-categorization-workflow.server')
    const starter = createFlueCategorizationWorkflowStarter(deps)

    const result = await starter.startBatch({userId: 'user-1'})

    expect(result).toEqual({appRunId: 'app-run-1'})
    expect(deps.resolveCurrentTeamId).toHaveBeenCalledWith({userId: 'user-1'})
    expect(deps.reserveWorkflowRun).toHaveBeenCalledWith({
      workflowName: 'categorize-transactions',
      teamId: 'team-1',
      requestedByUserId: 'user-1',
    })
    expect(deps.invokeFlueWorkflow).toHaveBeenCalledWith({
      appRunId: 'app-run-1',
      userId: 'user-1',
      teamId: 'team-1',
    })
  })

  it('turns duplicate active run conflicts into a user-facing message', async () => {
    const deps = defaultDeps()
    deps.reserveWorkflowRun.mockRejectedValue(new ActiveWorkflowRunExistsError('team-1', 'categorize-transactions'))
    const {createFlueCategorizationWorkflowStarter} = await import('@/ledger/flue-categorization-workflow.server')
    const starter = createFlueCategorizationWorkflowStarter(deps)

    await expect(starter.startBatch({userId: 'user-1'})).rejects.toThrow('AI categorization is already running for this team')
    expect(deps.invokeFlueWorkflow).not.toHaveBeenCalled()
  })

  it('marks the reserved app run failed when Flue admission fails', async () => {
    const deps = defaultDeps()
    deps.invokeFlueWorkflow.mockRejectedValue(new Error('sidecar unavailable'))
    const {createFlueCategorizationWorkflowStarter} = await import('@/ledger/flue-categorization-workflow.server')
    const starter = createFlueCategorizationWorkflowStarter(deps)

    await expect(starter.startTransaction({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})).rejects.toThrow('Could not start AI categorization workflow')

    expect(deps.markWorkflowRunFailed).toHaveBeenCalledWith({id: 'app-run-1', error: 'Flue rejected the workflow submission: sidecar unavailable'})
  })
})
