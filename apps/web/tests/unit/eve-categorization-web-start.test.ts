import {beforeEach, describe, expect, it, vi} from 'vitest'
import {ActiveWorkflowRunExistsError} from '@penge/domain/workflow-runs'

const defaultDeps = () => ({
  resolveBankTransactionTeamId: vi.fn(async () => 'team-1'),
  resolveCurrentTeamId: vi.fn(async () => 'team-1'),
  reconcileWorkflowRuns: vi.fn(async () => undefined),
  reserveWorkflowRun: vi.fn(async () => ({id: 'app-run-1'})),
  mintCategorizationTaskCapability: vi.fn(() => 'scoped-capability'),
  invokeEveCategorizationTask: vi.fn(async () => ({sessionId: 'eve-session-1', nextStreamIndex: 3})),
  attachEveSession: vi.fn(async () => undefined),
  markWorkflowRunFailed: vi.fn(async () => undefined),
})

describe('eve categorization web session starter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reserves an app workflow run and starts an eve task-mode session for a row-constrained transaction', async () => {
    const deps = defaultDeps()
    const {createEveCategorizationSessionStarter} = await import('@/ledger/eve-categorization-session.server')
    const starter = createEveCategorizationSessionStarter(deps)

    const result = await starter.startTransaction({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})

    expect(result).toEqual({appRunId: 'app-run-1'})
    expect(deps.resolveBankTransactionTeamId).toHaveBeenCalledWith({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})
    expect(deps.reconcileWorkflowRuns).toHaveBeenCalledWith({teamId: 'team-1', workflowName: 'categorize-transactions'})
    expect(deps.reserveWorkflowRun).toHaveBeenCalledWith({
      workflowName: 'categorize-transactions',
      teamId: 'team-1',
      requestedByUserId: 'user-1',
    })
    expect(deps.mintCategorizationTaskCapability).toHaveBeenCalledWith({
      appRunId: 'app-run-1',
      teamId: 'team-1',
      userId: 'user-1',
      targetBankTransactionIds: ['bank-transaction-1'],
    })
    expect(deps.invokeEveCategorizationTask).toHaveBeenCalledWith({
      appRunId: 'app-run-1',
      capability: 'scoped-capability',
    })
    expect(deps.attachEveSession).toHaveBeenCalledWith({
      id: 'app-run-1',
      eveSessionId: 'eve-session-1',
      eveNextStreamIndex: 3,
    })
  })

  it('starts an unconstrained eve batch task for the current team', async () => {
    const deps = defaultDeps()
    const {createEveCategorizationSessionStarter} = await import('@/ledger/eve-categorization-session.server')
    const starter = createEveCategorizationSessionStarter(deps)

    const result = await starter.startBatch({userId: 'user-1'})

    expect(result).toEqual({appRunId: 'app-run-1'})
    expect(deps.resolveCurrentTeamId).toHaveBeenCalledWith({userId: 'user-1'})
    expect(deps.invokeEveCategorizationTask).toHaveBeenCalledWith({
      appRunId: 'app-run-1',
      capability: 'scoped-capability',
    })
  })

  it('turns duplicate active run conflicts into a user-facing message without invoking eve', async () => {
    const deps = defaultDeps()
    deps.reserveWorkflowRun.mockRejectedValue(new ActiveWorkflowRunExistsError('team-1', 'categorize-transactions'))
    const {createEveCategorizationSessionStarter} = await import('@/ledger/eve-categorization-session.server')
    const starter = createEveCategorizationSessionStarter(deps)

    await expect(starter.startBatch({userId: 'user-1'})).rejects.toThrow('AI categorization is already running for this team')
    expect(deps.invokeEveCategorizationTask).not.toHaveBeenCalled()
  })

  it('marks the reserved app run failed when eve admission fails', async () => {
    const deps = defaultDeps()
    deps.invokeEveCategorizationTask.mockRejectedValue(new Error('runtime unavailable'))
    const {createEveCategorizationSessionStarter} = await import('@/ledger/eve-categorization-session.server')
    const starter = createEveCategorizationSessionStarter(deps)

    await expect(starter.startTransaction({userId: 'user-1', bankTransactionId: 'bank-transaction-1'})).rejects.toThrow('Could not start AI categorization task')

    expect(deps.markWorkflowRunFailed).toHaveBeenCalledWith({id: 'app-run-1', error: 'Eve rejected the task submission: runtime unavailable'})
  })

  it('keeps the workflow active when eve starts but session attachment fails', async () => {
    const deps = defaultDeps()
    deps.attachEveSession.mockRejectedValue(new Error('database temporarily unavailable'))
    const {createEveCategorizationSessionStarter} = await import('@/ledger/eve-categorization-session.server')
    const starter = createEveCategorizationSessionStarter(deps)

    await expect(starter.startBatch({userId: 'user-1'})).rejects.toThrow('AI categorization task started, but Penge could not record the Eve session')

    expect(deps.invokeEveCategorizationTask).toHaveBeenCalled()
    expect(deps.markWorkflowRunFailed).not.toHaveBeenCalled()
  })
})
