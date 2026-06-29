// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const flueMocks = vi.hoisted(() => ({
  workflow: {
    events: [] as unknown[],
    logs: [] as unknown[],
    status: 'idle',
    result: null,
    error: undefined as unknown,
  },
  useFlueWorkflow: vi.fn(() => flueMocks.workflow),
}))

vi.mock('@flue/react', () => ({
  useFlueWorkflow: flueMocks.useFlueWorkflow,
}))

describe('CategorizationWorkflowTrace', () => {
  it('renders nothing when there is no active run', async () => {
    const {CategorizationWorkflowTrace} = await import('@/components/ledger/categorization-workflow-trace')

    const markup = renderToStaticMarkup(React.createElement(CategorizationWorkflowTrace, {flueRunId: undefined}))

    expect(markup).toBe('')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: undefined})
  })

  it('renders a pending trace message before Flue attaches the run id', async () => {
    const {CategorizationWorkflowTrace} = await import('@/components/ledger/categorization-workflow-trace')

    const markup = renderToStaticMarkup(React.createElement(CategorizationWorkflowTrace, {flueRunId: null}))

    expect(markup).toContain('AI workflow trace')
    expect(markup).toContain('Preparing AI categorization trace')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: undefined})
  })

  it('renders only useful workflow trace items with cohesive text, thinking, tool calls, and logs', async () => {
    flueMocks.workflow = {
      events: [
        {v: 3, type: 'run_start', eventIndex: 0, timestamp: '2026-06-27T10:00:00.000Z', runId: 'flue-run-1', workflowName: 'categorize-transactions', startedAt: '2026-06-27T10:00:00.000Z', input: {}},
        {v: 3, type: 'turn_start', eventIndex: 1, timestamp: '2026-06-27T10:00:00.100Z', turnId: 'turn-1', purpose: 'main'},
        {v: 3, type: 'message_start', eventIndex: 2, timestamp: '2026-06-27T10:00:00.200Z', turnId: 'turn-1', message: {role: 'assistant', content: []}},
        {v: 3, type: 'thinking_delta', eventIndex: 3, timestamp: '2026-06-27T10:00:00.300Z', turnId: 'turn-1', contentIndex: 0, delta: 'Checking similar '},
        {v: 3, type: 'thinking_delta', eventIndex: 4, timestamp: '2026-06-27T10:00:00.400Z', turnId: 'turn-1', contentIndex: 0, delta: 'transactions.'},
        {v: 3, type: 'text_delta', eventIndex: 5, timestamp: '2026-06-27T10:00:00.500Z', turnId: 'turn-1', text: 'I will search '},
        {v: 3, type: 'text_delta', eventIndex: 6, timestamp: '2026-06-27T10:00:00.600Z', turnId: 'turn-1', text: 'recent transactions.'},
        {v: 3, type: 'tool_start', eventIndex: 7, timestamp: '2026-06-27T10:00:01.000Z', turnId: 'turn-1', toolName: 'searchBankTransactions', toolCallId: 'tool-1', args: {query: 'Netto', limit: 10}},
        {v: 3, type: 'tool', eventIndex: 8, timestamp: '2026-06-27T10:00:02.000Z', turnId: 'turn-1', toolName: 'searchBankTransactions', toolCallId: 'tool-1', isError: false, durationMs: 10},
        {v: 3, type: 'log', eventIndex: 9, timestamp: '2026-06-27T10:00:03.000Z', level: 'info', message: 'Applied categorization suggestion'},
        {v: 3, type: 'message_end', eventIndex: 10, timestamp: '2026-06-27T10:00:04.000Z', turnId: 'turn-1', message: {role: 'assistant', content: []}},
      ],
      logs: [],
      status: 'running',
      result: null,
      error: undefined,
    }
    const {CategorizationWorkflowTrace} = await import('@/components/ledger/categorization-workflow-trace')

    const markup = renderToStaticMarkup(React.createElement(CategorizationWorkflowTrace, {flueRunId: 'flue-run-1'}))

    expect(markup).toContain('AI workflow trace')
    expect(markup).toContain('running')
    expect(markup).toContain('Thinking')
    expect(markup).toContain('Checking similar transactions.')
    expect(markup).toContain('Agent')
    expect(markup).toContain('I will search recent transactions.')
    expect(markup).toContain('Tool')
    expect(markup).toContain('searchBankTransactions')
    expect(markup).toContain('Netto')
    expect(markup).toContain('Finished in 10 ms')
    expect(markup).toContain('Log')
    expect(markup).toContain('Applied categorization suggestion')
    expect(markup).not.toContain('Workflow started')
    expect(markup).not.toContain('AI started a model step')
    expect(markup).not.toContain('message_start')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: 'flue-run-1'})
  })
})
