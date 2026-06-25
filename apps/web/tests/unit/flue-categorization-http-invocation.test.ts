import {beforeEach, describe, expect, it, vi} from 'vitest'

const dbLimit = vi.fn(async () => [{teamId: 'team-1'}])
const reserveActiveAgentWorkflowRun = vi.fn(async () => ({id: 'app-run-1'}))
const markAgentWorkflowRunFailed = vi.fn(async () => undefined)

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: dbLimit,
          })),
        })),
      })),
    })),
  },
  sql: vi.fn(),
}))

vi.mock('@penge/domain/workflow-runs', () => ({
  ActiveWorkflowRunExistsError: class ActiveWorkflowRunExistsError extends Error {
    readonly code = 'ACTIVE_WORKFLOW_RUN_EXISTS'
  },
  reserveActiveAgentWorkflowRun,
  markAgentWorkflowRunFailed,
}))

describe('Flue categorization HTTP invocation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.PENGE_FLUE_BASE_URL = 'http://flue.test/'
    process.env.PENGE_FLUE_INTERNAL_TOKEN = 'test-token'
  })

  it('posts the workflow input directly in the request body Flue validates', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({runId: 'flue-run-1'}), {status: 202}))
    vi.stubGlobal('fetch', fetchMock)
    const {startFlueCategorizeNeedsReviewWorkflow} = await import('@/ledger/flue-categorization-workflow.server')

    await startFlueCategorizeNeedsReviewWorkflow({userId: 'user-1'})

    expect(fetchMock).toHaveBeenCalledWith('http://flue.test/workflows/categorize-transactions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        appRunId: 'app-run-1',
        userId: 'user-1',
        teamId: 'team-1',
      }),
    })
  })
})
