import {describe, expect, it, vi} from 'vitest'
import {
  CATEGORIZE_TRANSACTIONS_WORKFLOW_LIMITS,
  buildCategorizationWorkflowPrompt,
  executeCategorizationWorkflow,
} from '../../../flue/src/workflows/categorize-transactions'

type PromptFn = (text: string, options?: {tools?: TestTool[]}) => Promise<unknown>
type TestHarness = {name: string; session(): Promise<{prompt: PromptFn}>}
type TestTool = {name: string; description: string; input: undefined; output: undefined; run: ReturnType<typeof vi.fn>}

describe('Flue categorize-transactions workflow', () => {
  it('builds mission instructions for autonomous batch and row-constrained runs', () => {
    const batchPrompt = buildCategorizationWorkflowPrompt({
      appRunId: 'app-run-1',
      userId: 'user-1',
      teamId: 'team-1',
    })

    expect(batchPrompt).toContain('Continue until no eligible writable transactions remain')
    expect(batchPrompt).toContain('100 transactions')
    expect(batchPrompt).toContain('10 minutes')
    expect(batchPrompt).toContain('Use searchLedgerAccounts and searchLedgerTransactions')
    expect(batchPrompt).toContain('Never invent account ids')
    expect(batchPrompt).toContain('Do not reveal private chain-of-thought')

    const rowPrompt = buildCategorizationWorkflowPrompt({
      appRunId: 'app-run-1',
      userId: 'user-1',
      teamId: 'team-1',
      targetBankTransactionIds: ['bank-transaction-1'],
    })

    expect(rowPrompt).toContain('This is a row-constrained run')
    expect(rowPrompt).toContain('bank-transaction-1')
    expect(rowPrompt).toContain('Do not write any transaction whose canWrite flag is false')
  })

  it('attaches the Flue run id, provides scoped tools, and completes the app workflow run on success', async () => {
    const prompt = vi.fn(async () => ({text: 'done', usage: {}, model: {provider: 'test', id: 'model'}}))
    const harness = fakeHarness('flue-run-1', prompt)
    const tools = [fakeTool('searchBankTransactions'), fakeTool('applyInterpretation')]
    const lifecycle = {
      attachFlueRunId: vi.fn(async () => undefined),
      markCompleted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    }

    await expect(executeCategorizationWorkflow({
      harness,
      input: {
        appRunId: 'app-run-1',
        userId: 'user-1',
        teamId: 'team-1',
        targetBankTransactionIds: ['bank-transaction-1'],
      },
      lifecycle,
      createTools: () => tools,
    })).resolves.toEqual({status: 'completed'})

    expect(lifecycle.attachFlueRunId).toHaveBeenCalledWith({appRunId: 'app-run-1', flueRunId: 'flue-run-1'})
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('bank-transaction-1'), {tools})
    expect(lifecycle.markCompleted).toHaveBeenCalledWith({appRunId: 'app-run-1'})
    expect(lifecycle.markFailed).not.toHaveBeenCalled()
  })

  it('marks the app workflow run failed and rethrows when the agent fails', async () => {
    const error = new Error('model provider unavailable')
    const prompt = vi.fn(async () => {
      throw error
    })
    const lifecycle = {
      attachFlueRunId: vi.fn(async () => undefined),
      markCompleted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    }

    await expect(executeCategorizationWorkflow({
      harness: fakeHarness('flue-run-1', prompt),
      input: {appRunId: 'app-run-1', userId: 'user-1', teamId: 'team-1'},
      lifecycle,
      createTools: () => [fakeTool('searchBankTransactions')],
    })).rejects.toThrow('model provider unavailable')

    expect(lifecycle.markCompleted).not.toHaveBeenCalled()
    expect(lifecycle.markFailed).toHaveBeenCalledWith({
      appRunId: 'app-run-1',
      error: 'model provider unavailable',
    })
  })

  it('keeps the first workflow cap at the agreed 100 transactions and 10 minutes', () => {
    expect(CATEGORIZE_TRANSACTIONS_WORKFLOW_LIMITS).toEqual({maxTransactions: 100, maxDurationMinutes: 10})
  })
})

function fakeHarness(name: string, prompt: PromptFn): TestHarness {
  return {
    name,
    session: vi.fn(async () => ({prompt})),
  }
}

function fakeTool(name: string): TestTool {
  return {
    name,
    description: `${name} tool`,
    input: undefined,
    output: undefined,
    run: vi.fn(),
  }
}
