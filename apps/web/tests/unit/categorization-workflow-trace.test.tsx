// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

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
  FlueProvider: ({children}: {children: React.ReactNode}) => children,
  useFlueWorkflow: flueMocks.useFlueWorkflow,
}))

describe('CategorizationWorkflowTrace', () => {
  beforeEach(() => {
    flueMocks.workflow = {
      events: [],
      logs: [],
      status: 'idle',
      result: null,
      error: undefined,
    }
    flueMocks.useFlueWorkflow.mockClear()
  })

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

  it('renders safe categorization progress and hides raw tool details', async () => {
    flueMocks.workflow = {
      events: [
        {v: 3, type: 'run_start', eventIndex: 0, timestamp: '2026-06-27T10:00:00.000Z', runId: 'flue-run-1', workflowName: 'categorize-transactions', startedAt: '2026-06-27T10:00:00.000Z', input: {}},
        {v: 3, type: 'thinking_delta', eventIndex: 1, timestamp: '2026-06-27T10:00:00.300Z', turnId: 'turn-1', contentIndex: 0, delta: 'Private model reasoning'},
        {v: 3, type: 'tool_start', eventIndex: 2, timestamp: '2026-06-27T10:00:01.000Z', turnId: 'turn-1', toolName: 'applyCategorizationSuggestion', toolCallId: 'tool-1', args: {bankTransactionId: 'txn-secret-id', categoryAccountId: 'acct-secret-id'}},
        {v: 3, type: 'tool', eventIndex: 3, timestamp: '2026-06-27T10:00:02.000Z', turnId: 'turn-1', toolName: 'applyCategorizationSuggestion', toolCallId: 'tool-1', isError: false, result: {bankTransactionId: 'txn-secret-id'}, durationMs: 10},
        {v: 3, type: 'data', eventIndex: 4, timestamp: '2026-06-27T10:00:03.000Z', name: 'penge.workflow.progress', id: 'applying-suggestions', data: {message: 'Applying categorization suggestions…'}},
        {v: 3, type: 'data', eventIndex: 5, timestamp: '2026-06-27T10:00:04.000Z', name: 'penge.workflow.progress', id: 'finishing', data: {message: 'Finishing workflow…'}},
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
    expect(markup).toContain('Applying categorization suggestions')
    expect(markup).toContain('Finishing workflow')
    expect(markup).not.toContain('Private model reasoning')
    expect(markup).not.toContain('applyCategorizationSuggestion')
    expect(markup).not.toContain('txn-secret-id')
    expect(markup).not.toContain('acct-secret-id')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: 'flue-run-1'})
  })
})
