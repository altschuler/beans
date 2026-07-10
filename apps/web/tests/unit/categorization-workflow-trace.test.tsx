// @vitest-environment jsdom
import React from 'react'
import {act, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CategorizationWorkflowTrace} from '@/components/ledger/categorization-workflow-trace'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CategorizationWorkflowTrace', () => {
  it('renders nothing when there is no active run', () => {
    const {container} = render(<CategorizationWorkflowTrace run={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders pending state before Eve attaches the session', () => {
    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'pending', error: null}} />)

    expect(screen.getByRole('region', {name: 'AI workflow trace'})).toHaveTextContent('Preparing AI categorization trace')
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('derives safe phase labels from scrubbed Eve tool events', async () => {
    const body = [
      {type: 'actions.requested', data: {sequence: 0, turnId: 'turn-1', stepIndex: 0, actions: [
        {kind: 'tool-call', callId: 'call-1', toolName: 'searchBankTransactions', input: {}},
        {kind: 'tool-call', callId: 'call-2', toolName: 'applyCategorizationSuggestion', input: {}},
      ]}},
      {type: 'session.completed'},
    ].map(event => JSON.stringify(event)).join('\n') + '\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {headers: {'content-type': 'application/x-ndjson'}})))

    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'running', error: null}} />)

    await waitFor(() => {
      expect(screen.getByText('Finding transactions…')).toBeInTheDocument()
      expect(screen.getByText('Applying categorization suggestions…')).toBeInTheDocument()
    })
    expect(document.body).not.toHaveTextContent('searchBankTransactions')
    expect(document.body).not.toHaveTextContent('applyCategorizationSuggestion')
  })

  it('reconnects a trace that ends early and resumes from the next event index', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`${JSON.stringify({type: 'actions.requested', data: {actions: [
        {kind: 'tool-call', callId: 'call-1', toolName: 'searchBankTransactions'},
      ]}})}\n`))
      .mockResolvedValueOnce(new Response(`${JSON.stringify({type: 'actions.requested', data: {actions: [
        {kind: 'tool-call', callId: 'call-2', toolName: 'searchLedgerAccounts'},
      ]}})}\n${JSON.stringify({type: 'session.completed'})}\n`))
    vi.stubGlobal('fetch', fetchMock)

    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'running', error: null}} />)
    await act(async () => undefined)
    expect(screen.getByText('Finding transactions…')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(250))
    await act(async () => undefined)

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/eve/categorization/app-run-1/trace?startIndex=1',
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    )
    expect(screen.getByText('Checking available categories…')).toBeInTheDocument()
  })

  it('backs off repeated clean stream endings', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response(`${JSON.stringify({type: 'session.completed'})}\n`))
    vi.stubGlobal('fetch', fetchMock)

    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'running', error: null}} />)
    await act(async () => undefined)
    await act(async () => vi.advanceTimersByTime(250))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTime(499))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTime(1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('resumes after a mid-stream read error without replaying consumed events', async () => {
    vi.useFakeTimers()
    const interruptedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({type: 'actions.requested', data: {actions: [
          {kind: 'tool-call', callId: 'call-1', toolName: 'searchBankTransactions'},
        ]}})}\n`))
        window.setTimeout(() => controller.error(new Error('stream interrupted')), 1)
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(interruptedBody))
      .mockResolvedValueOnce(new Response(`${JSON.stringify({type: 'session.completed'})}\n`))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)

    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'running', error: null}} />)
    await act(async () => undefined)
    await act(async () => vi.advanceTimersByTime(1))
    await act(async () => vi.advanceTimersByTime(250))
    await act(async () => undefined)

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/eve/categorization/app-run-1/trace?startIndex=1',
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    )
    errorSpy.mockRestore()
  })

  it('retries after a transient trace connection error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(new Response(`${JSON.stringify({type: 'session.completed'})}\n`))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)

    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'running', error: null}} />)
    await act(async () => undefined)
    expect(screen.getByText('Could not connect to AI categorization trace.')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(250))
    await act(async () => undefined)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Could not connect to AI categorization trace.')).toBeNull()
    errorSpy.mockRestore()
  })

  it('renders terminal status from the app-owned run instead of the stream', () => {
    render(<CategorizationWorkflowTrace run={{id: 'app-run-1', status: 'failed', error: 'AI categorization failed'}} />)

    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('AI categorization failed')).toBeInTheDocument()
  })
})
