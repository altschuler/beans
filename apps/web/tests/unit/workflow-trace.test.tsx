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
  useFlueWorkflow: flueMocks.useFlueWorkflow,
}))

describe('WorkflowTrace', () => {
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
    const {WorkflowTrace} = await import('@/components/flue/workflow-trace')

    const markup = renderToStaticMarkup(React.createElement(WorkflowTrace, {flueRunId: undefined}))

    expect(markup).toBe('')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: undefined})
  })

  it('renders configurable copy before Flue attaches the run id', async () => {
    const {WorkflowTrace} = await import('@/components/flue/workflow-trace')

    const markup = renderToStaticMarkup(React.createElement(WorkflowTrace, {
      flueRunId: null,
      title: 'Custom trace',
      description: 'Reusable workflow trace.',
      pendingMessage: 'Waiting for run id…',
      ariaLabel: 'Custom workflow trace',
    }))

    expect(markup).toContain('Custom trace')
    expect(markup).toContain('Reusable workflow trace.')
    expect(markup).toContain('Waiting for run id')
    expect(markup).toContain('aria-label="Custom workflow trace"')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: undefined})
  })

  it('renders safe app-authored progress data events and hides raw trace internals', async () => {
    flueMocks.workflow = {
      events: [
        {v: 3, type: 'run_start', eventIndex: 0, timestamp: '2026-06-27T10:00:00.000Z', runId: 'flue-run-1', workflowName: 'categorize-transactions', startedAt: '2026-06-27T10:00:00.000Z', input: {}},
        {v: 3, type: 'thinking_delta', eventIndex: 1, timestamp: '2026-06-27T10:00:00.300Z', turnId: 'turn-1', contentIndex: 0, delta: 'Private model reasoning'},
        {v: 3, type: 'text_delta', eventIndex: 2, timestamp: '2026-06-27T10:00:00.500Z', turnId: 'turn-1', text: 'Internal assistant scratch text'},
        {v: 3, type: 'tool_start', eventIndex: 3, timestamp: '2026-06-27T10:00:01.000Z', turnId: 'turn-1', toolName: 'searchBankTransactions', toolCallId: 'tool-1', args: {query: 'Netto', bankTransactionId: 'txn-secret-id'}},
        {v: 3, type: 'tool', eventIndex: 4, timestamp: '2026-06-27T10:00:02.000Z', turnId: 'turn-1', toolName: 'searchBankTransactions', toolCallId: 'tool-1', isError: false, result: {accountId: 'acct-secret-id'}, durationMs: 10},
        {v: 3, type: 'log', eventIndex: 5, timestamp: '2026-06-27T10:00:03.000Z', level: 'info', message: 'Internal log with run-secret-id'},
        {v: 3, type: 'data', eventIndex: 6, timestamp: '2026-06-27T10:00:04.000Z', name: 'penge.workflow.progress', id: 'finding-transactions', data: {message: 'Finding transactions that need review…'}},
        {v: 3, type: 'data', eventIndex: 7, timestamp: '2026-06-27T10:00:05.000Z', name: 'penge.workflow.progress', id: 'checking-categories', data: {message: 'Checking available categories…'}},
        {v: 3, type: 'data', eventIndex: 8, timestamp: '2026-06-27T10:00:06.000Z', name: 'third-party.debug', data: {message: 'Unsafe event with provider details'}},
        {v: 3, type: 'data', eventIndex: 9, timestamp: '2026-06-27T10:00:07.000Z', name: 'penge.workflow.progress', data: {message: 'Unsafe progress text with txn-secret-id'}},
      ],
      logs: [],
      status: 'running',
      result: null,
      error: undefined,
    }
    const {WorkflowTrace} = await import('@/components/flue/workflow-trace')

    const markup = renderToStaticMarkup(React.createElement(WorkflowTrace, {flueRunId: 'flue-run-1'}))

    expect(markup).toContain('Workflow trace')
    expect(markup).toContain('running')
    expect(markup).toContain('Finding transactions that need review')
    expect(markup).toContain('Checking available categories')
    expect(markup).not.toContain('Private model reasoning')
    expect(markup).not.toContain('Internal assistant scratch text')
    expect(markup).not.toContain('searchBankTransactions')
    expect(markup).not.toContain('Netto')
    expect(markup).not.toContain('txn-secret-id')
    expect(markup).not.toContain('acct-secret-id')
    expect(markup).not.toContain('Internal log with run-secret-id')
    expect(markup).not.toContain('Unsafe event with provider details')
    expect(markup).not.toContain('Unsafe progress text')
    expect(flueMocks.useFlueWorkflow).toHaveBeenCalledWith({runId: 'flue-run-1'})
  })
})
