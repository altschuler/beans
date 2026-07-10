// @vitest-environment jsdom
import React from 'react'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {HandleMessageStreamEvent} from 'eve/client'

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  clientOptions: [] as unknown[],
  sessionStates: [] as unknown[],
  send: vi.fn(),
  stream: vi.fn(),
  useAgent: vi.fn(),
  stop: vi.fn(),
  eventRows: [] as Array<{sessionOrdinal: number; streamIndex: number; event: unknown}>,
  approvalRows: [] as unknown[],
}))

vi.mock('@/eve/chat-bootstrap', () => ({bootstrapEveChat: mocks.bootstrap}))
vi.mock('@/zero/queries', () => ({queries: {domain: {
  teamDataAssistantChatEventsByChat: (input: unknown) => ({name: 'events', input}),
  teamDataAssistantChatApprovalsByChat: (input: unknown) => ({name: 'approvals', input}),
}}}))
vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: {name: string}) => query.name === 'events'
    ? [mocks.eventRows, {type: 'complete'}]
    : [mocks.approvalRows, {type: 'complete'}],
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({select}: {select(state: {location: {pathname: string}}): string}) => select({location: {pathname: '/app/transactions'}}),
}))
vi.mock('eve/client', async importOriginal => {
  const actual = await importOriginal<typeof import('eve/client')>()
  return {
    ...actual,
    Client: class {
      constructor(options: unknown) { mocks.clientOptions.push(options) }
      session(state: unknown) {
        mocks.sessionStates.push(state)
        return {state, send: mocks.send, stream: mocks.stream}
      }
    },
  }
})
vi.mock('eve/react', async importOriginal => {
  const actual = await importOriginal<typeof import('eve/react')>()
  return {
    ...actual,
    useEveAgent: (options: {initialEvents?: HandleMessageStreamEvent[]}) => {
      mocks.useAgent(options)
      return {data: {messages: []}, events: [], session: {streamIndex: 0}, status: 'ready', error: undefined, reset: vi.fn(), send: vi.fn(), stop: mocks.stop}
    },
  }
})

import {EveChatSession} from '@/components/assistant/eve-chat-session'

describe('EveChatSession lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.eventRows = []
    mocks.approvalRows = []
    mocks.send.mockResolvedValue({sessionId: 'session-1', continuationToken: 'continuation-1'})
    mocks.stream.mockImplementation(async function* () {})
    Object.defineProperty(navigator, 'onLine', {configurable: true, value: true})
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'})
  })

  it.each(['admitting', 'reconnecting'] as const)('polls %s state without constructing an Eve client session', async sessionState => {
    mocks.bootstrap.mockResolvedValue({
      session: null,
      sessionOrdinal: 1,
      sessionState,
      requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
    })
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)

    expect(await screen.findByText('Loading chat…')).toBeInTheDocument()
    expect(mocks.useAgent).not.toHaveBeenCalled()
    expect(mocks.clientOptions).toEqual([])
  })

  it('retries a failed bootstrap with bounded coalesced backoff', async () => {
    mocks.bootstrap
      .mockRejectedValueOnce(new Error('raw bootstrap failure'))
      .mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    expect(await screen.findByText('Ask Penge is temporarily unavailable.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(2), {timeout: 2_000})
    expect(await screen.findByLabelText('Message Ask Penge')).toBeEnabled()
  })

  it('starts a fresh admitting retry epoch when admitting is entered after a long-lived mount', async () => {
    mocks.bootstrap
      .mockResolvedValueOnce({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
      .mockResolvedValueOnce({session: null, sessionOrdinal: 1, sessionState: 'admitting', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0}})
      .mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 1, sessionState: 'failed', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0}})
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await screen.findByLabelText('Message Ask Penge')
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(3), {timeout: 2_000})
    expect(await screen.findByLabelText('Message Ask Penge')).toBeEnabled()
  })

  it('explicitly attaches a running session and recovers after a boundary', async () => {
    mocks.bootstrap
      .mockResolvedValueOnce({
        session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0},
        sessionOrdinal: 1,
        sessionState: 'running',
        requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
      })
      .mockResolvedValue({
        session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 1},
        sessionOrdinal: 1,
        sessionState: 'waiting',
        requiredEventCursor: {sessionOrdinal: 1, streamIndex: 1},
      })
    mocks.stream.mockImplementation(async function* () {
      yield {type: 'session.waiting', data: {wait: 'next-user-message'}} as HandleMessageStreamEvent
    })
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)

    await waitFor(() => expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({startIndex: 0, signal: expect.any(AbortSignal)})))
    expect(mocks.clientOptions[0]).toEqual(expect.objectContaining({host: '/api/eve/chat/chat-1', maxReconnectAttempts: 0, redirect: 'error'}))
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(2))
  })

  it('keeps retrying when EOF recovery bootstrap fails, without overlapping attachments', async () => {
    mocks.bootstrap
      .mockResolvedValueOnce({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 1, sessionState: 'running', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0}})
      .mockRejectedValueOnce(new Error('temporary bootstrap failure'))
      .mockResolvedValue({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 1, sessionState: 'running', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0}})
    mocks.stream.mockImplementation(async function* () { if (Date.now() < 0) yield {type: 'session.completed'} as HandleMessageStreamEvent })
    const {unmount} = render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await waitFor(() => expect(mocks.bootstrap.mock.calls.length).toBeGreaterThanOrEqual(3), {timeout: 3_000})
    await waitFor(() => expect(mocks.stream.mock.calls.length).toBeGreaterThanOrEqual(2), {timeout: 2_000})
    unmount()
  })

  it('recovers and reattaches after an unexpected stream EOF without overlapping attachments', async () => {
    mocks.bootstrap.mockResolvedValue({
      session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0},
      sessionOrdinal: 1,
      sessionState: 'running',
      requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
    })
    let activeStreams = 0
    let maximumActiveStreams = 0
    mocks.stream.mockImplementation(async function* () {
      activeStreams += 1
      maximumActiveStreams = Math.max(maximumActiveStreams, activeStreams)
      if (activeStreams < 0) yield {type: 'session.waiting', data: {wait: 'next-user-message'}} as HandleMessageStreamEvent
      activeStreams -= 1
    })
    const {unmount} = render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await waitFor(() => expect(mocks.stream.mock.calls.length).toBeGreaterThanOrEqual(2), {timeout: 2_000})
    expect(maximumActiveStreams).toBe(1)
    unmount()
  })

  it('sequences visible recovery after the stopped stream settles', async () => {
    let streamSettled = false
    mocks.bootstrap.mockResolvedValue({
      session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 1,
      sessionState: 'running', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
    })
    mocks.stream.mockImplementation(({signal}: {signal?: AbortSignal}) => ({async *[Symbol.asyncIterator]() {
      if (!signal) yield {type: 'session.completed'} as HandleMessageStreamEvent
      try {
        await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), {once: true}))
      } finally {
        streamSettled = true
      }
    }}))
    const {unmount} = render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1))
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'})
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'})
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(2))
    expect(streamSettled).toBe(true)
    unmount()
  })

  it('stops only the local attachment, keeps the composer blocked, and explicitly reattaches', async () => {
    mocks.bootstrap.mockResolvedValue({
      session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0},
      sessionOrdinal: 1,
      sessionState: 'running',
      requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
    })
    mocks.stream.mockImplementation(({signal}: {signal?: AbortSignal}) => ({async *[Symbol.asyncIterator]() {
      if (!signal) yield {type: 'session.waiting', data: {wait: 'next-user-message'}} as HandleMessageStreamEvent
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), {once: true}))
    }}))
    const user = userEvent.setup()
    const {unmount} = render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    const stop = await screen.findByRole('button', {name: 'Stop response'})
    expect(screen.getByLabelText('Message Ask Penge')).toBeDisabled()
    await user.click(stop)
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2))
    expect(mocks.stop).toHaveBeenCalled()
    expect(screen.getByLabelText('Message Ask Penge')).toBeDisabled()
    unmount()
  })

  it('aborts the explicit attachment on unmount and recovers when the browser comes online', async () => {
    mocks.bootstrap.mockResolvedValue({
      session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0},
      sessionOrdinal: 1,
      sessionState: 'running',
      requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
    })
    let streamSignal: AbortSignal | undefined
    mocks.stream.mockImplementation(({signal}: {signal?: AbortSignal}) => {
      streamSignal = signal
      return {async *[Symbol.asyncIterator]() {
        if (!signal) yield {type: 'session.waiting', data: {wait: 'next-user-message'}} as HandleMessageStreamEvent
        await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), {once: true}))
      }}
    })
    const {unmount} = render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(2))
    unmount()
    expect(streamSignal?.aborted).toBe(true)
  })

  it('exhausts failing bootstrap retries, stops calls, and explicit Retry resets the epoch', async () => {
    vi.useFakeTimers()
    try {
      let active = 0
      let maximumActive = 0
      mocks.bootstrap.mockImplementation(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        throw new Error('temporary')
      })
      render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      await act(async () => { await vi.advanceTimersByTimeAsync(130_000) })
      expect(screen.getByText('Ask Penge could not reconnect. Try again.')).toBeInTheDocument()
      const callsAtCeiling = mocks.bootstrap.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(mocks.bootstrap).toHaveBeenCalledTimes(callsAtCeiling)
      expect(maximumActive).toBe(1)
      mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
      fireEvent.click(screen.getByRole('button', {name: 'Retry Ask Penge connection'}))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByLabelText('Message Ask Penge')).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps one deadline across same-session EOF/bootstrap success loops and preserves the draft', async () => {
    vi.useFakeTimers()
    try {
      mocks.bootstrap.mockResolvedValue({
        session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 1,
        sessionState: 'running', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0},
      })
      mocks.stream.mockImplementation(async function* () { if (Date.now() < 0) yield {type: 'session.completed'} as HandleMessageStreamEvent })
      render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
      await act(async () => { await Promise.resolve() })
      fireEvent.change(screen.getByLabelText('Message Ask Penge'), {target: {value: 'surviving draft'}})
      await act(async () => { await vi.advanceTimersByTimeAsync(130_000) })
      expect(screen.getByText('Ask Penge could not reconnect. Try again.')).toBeInTheDocument()
      expect(screen.getByLabelText('Message Ask Penge')).toHaveValue('surviving draft')
      const callsAtCeiling = mocks.bootstrap.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(mocks.bootstrap).toHaveBeenCalledTimes(callsAtCeiling)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves a draft through offline/online and hidden/visible recovery', async () => {
    vi.useFakeTimers()
    try {
      mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
      render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
      await act(async () => { await Promise.resolve() })
      const composer = screen.getByLabelText('Message Ask Penge')
      fireEvent.change(composer, {target: {value: 'survive transitions'}})
      Object.defineProperty(navigator, 'onLine', {configurable: true, value: false})
      fireEvent.submit(composer.closest('form')!)
      Object.defineProperty(navigator, 'onLine', {configurable: true, value: true})
      window.dispatchEvent(new Event('online'))
      Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'})
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'})
      document.dispatchEvent(new Event('visibilitychange'))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByLabelText('Message Ask Penge')).toHaveValue('survive transitions')
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains the draft and history state until admission succeeds', async () => {
    const receipt = deferred<{sessionId: string; continuationToken: string}>()
    const firstSubmit = vi.fn()
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
    mocks.send.mockReturnValue(receipt.promise)
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={firstSubmit} />)
    const composer = await screen.findByLabelText('Message Ask Penge')
    await user.type(composer, 'one turn')
    const form = composer.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({message: 'one turn', signal: expect.any(AbortSignal)}))
    expect(composer).toHaveValue('one turn')
    expect(firstSubmit).not.toHaveBeenCalled()

    receipt.resolve({sessionId: 'session-1', continuationToken: 'continuation-1'})
    await waitFor(() => expect(firstSubmit).toHaveBeenCalledOnce())
    expect(composer).toHaveValue('')
  })

  it('retains the draft and does not mark history when admission fails', async () => {
    const firstSubmit = vi.fn()
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
    mocks.send.mockRejectedValue(new Error('pre-admission rejection'))
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={firstSubmit} />)
    const composer = await screen.findByLabelText('Message Ask Penge')
    await user.type(composer, 'keep failed turn')
    await user.click(screen.getByRole('button', {name: 'Send message'}))

    expect(await screen.findByText('Ask Penge could not complete this response.')).toBeInTheDocument()
    expect(composer).toHaveValue('keep failed turn')
    expect(firstSubmit).not.toHaveBeenCalled()
  })

  it('preserves an offline draft and reports a fixed recoverable status', async () => {
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    const composer = await screen.findByLabelText('Message Ask Penge')
    await user.type(composer, 'keep this draft')
    Object.defineProperty(navigator, 'onLine', {configurable: true, value: false})
    await user.click(screen.getByRole('button', {name: 'Send message'}))
    expect(composer).toHaveValue('keep this draft')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByText('Ask Penge is temporarily unavailable.')).toBeInTheDocument()
  })

  it.each(['stop', 'unmount', 'switch'] as const)('aborts a pending send on %s and ignores its late receipt', async action => {
    const receipt = deferred<{sessionId: string; continuationToken: string}>()
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
    mocks.send.mockReturnValue(receipt.promise)
    const user = userEvent.setup()
    const view = render(<EveChatSession key="chat-1" chatId="chat-1" onFirstSubmit={vi.fn()} />)
    const composer = await screen.findByLabelText('Message Ask Penge')
    await user.type(composer, 'pending turn')
    fireEvent.submit(composer.closest('form')!)
    const signal = mocks.send.mock.calls[0]?.[0].signal as AbortSignal
    if (action === 'stop') await user.click(screen.getByRole('button', {name: 'Stop response'}))
    if (action === 'unmount') view.unmount()
    if (action === 'switch') view.rerender(<EveChatSession key="chat-2" chatId="chat-2" onFirstSubmit={vi.fn()} />)
    expect(signal.aborted).toBe(true)
    receipt.resolve({sessionId: 'late-session', continuationToken: 'late-token'})
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.stream).not.toHaveBeenCalled()
    view.unmount()
  })

  it('clears reconnecting after a transient recovery failure and later bootstrap success', async () => {
    mocks.bootstrap
      .mockResolvedValueOnce({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 1, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0}})
      .mockRejectedValueOnce(new Error('temporary bootstrap failure'))
      .mockResolvedValue({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 1, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 0}})
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await screen.findByLabelText('Message Ask Penge')

    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(3), {timeout: 2_000})
    await waitFor(() => expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Message Ask Penge')).toBeEnabled()
  })

  it('shows persisted failures only for the current session ordinal', async () => {
    mocks.eventRows = [{
      sessionOrdinal: 1,
      streamIndex: 0,
      event: {type: 'session.failed', data: {message: 'This chat session could not be resumed.'}},
    }]
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 2, sessionState: 'completed', requiredEventCursor: {sessionOrdinal: 2, streamIndex: 0}})
    const view = render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await screen.findByLabelText('Message Ask Penge')
    expect(screen.queryByText('This chat session could not be resumed.')).not.toBeInTheDocument()

    view.unmount()
    mocks.eventRows = [{
      sessionOrdinal: 2,
      streamIndex: 0,
      event: {type: 'session.failed', data: {message: 'Ask Penge could not complete this response.'}},
    }]
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 2, sessionState: 'failed', requiredEventCursor: {sessionOrdinal: 2, streamIndex: 1}})
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    expect(await screen.findByText('Ask Penge could not complete this response.')).toBeInTheDocument()
  })

  it('starts a terminal chat through a fresh session without reusing terminal handles', async () => {
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 4, sessionState: 'completed', requiredEventCursor: {sessionOrdinal: 4, streamIndex: 0}})
    mocks.stream.mockImplementation(async function* () { yield {type: 'session.completed'} as HandleMessageStreamEvent })
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await user.type(await screen.findByLabelText('Message Ask Penge'), 'fresh start')
    await user.click(screen.getByRole('button', {name: 'Send message'}))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(mocks.sessionStates).toContainEqual({streamIndex: 0})
  })

  it('renders a current expired approval as finalized', async () => {
    mocks.approvalRows = [{
      id: 'approval-1', sessionOrdinal: 2, requestId: 'request-1', callId: 'call-1', toolName: 'manageCategory',
      safeProposal: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Household'}},
      projectionStatus: 'ready', resolutionStatus: 'expired',
    }]
    mocks.bootstrap.mockResolvedValue({session: {streamIndex: 0}, sessionOrdinal: 2, sessionState: 'completed', requiredEventCursor: {sessionOrdinal: 2, streamIndex: 0}})
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)

    expect(await screen.findByText('This approval expired when the chat session ended.')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Approve proposed change'})).not.toBeInTheDocument()
  })

  it('submits the public approval wire response only after immutable local validation', async () => {
    const proposal = {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Household'}}
    mocks.approvalRows = [{
      id: 'approval-1', sessionOrdinal: 2, requestId: 'request-1', callId: 'call-1', toolName: 'manageCategory',
      safeProposal: proposal, projectionStatus: 'ready', resolutionStatus: 'pending',
    }]
    mocks.bootstrap.mockResolvedValue({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 2, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 2, streamIndex: 0}})
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    await user.click(await screen.findByRole('button', {name: 'Approve proposed change'}))
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}], signal: expect.any(AbortSignal),
    }))
  })

  it('blocks an approval action when its immutable proposal changes before submission', async () => {
    const row = {
      id: 'approval-1', sessionOrdinal: 2, requestId: 'request-1', callId: 'call-1', toolName: 'manageCategory',
      safeProposal: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Household'}}, projectionStatus: 'ready', resolutionStatus: 'pending',
    }
    mocks.approvalRows = [row]
    mocks.bootstrap.mockResolvedValue({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 2, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 2, streamIndex: 0}})
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    const approve = await screen.findByRole('button', {name: 'Approve proposed change'})
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    row.safeProposal = {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Changed'}}
    await user.click(approve)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('keeps an offline approval actionable and does not send it', async () => {
    mocks.approvalRows = [{
      id: 'approval-1', sessionOrdinal: 2, requestId: 'request-1', callId: 'call-1', toolName: 'manageCategory',
      safeProposal: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Household'}}, projectionStatus: 'ready', resolutionStatus: 'pending',
    }]
    mocks.bootstrap.mockResolvedValue({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 0}, sessionOrdinal: 2, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 2, streamIndex: 0}})
    Object.defineProperty(navigator, 'onLine', {configurable: true, value: false})
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />)
    const approve = await screen.findByRole('button', {name: 'Approve proposed change'})
    await user.click(approve)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(approve).toBeEnabled()
    expect(screen.getByText('Ask Penge is temporarily unavailable.')).toBeInTheDocument()
  })

  it('admits only one fresh turn, sends normalized context, then owns the receipt stream', async () => {
    mocks.bootstrap
      .mockResolvedValueOnce({session: {streamIndex: 0}, sessionOrdinal: 0, sessionState: 'none', requiredEventCursor: {sessionOrdinal: 0, streamIndex: 0}})
      .mockResolvedValue({session: {sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 1}, sessionOrdinal: 1, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 1, streamIndex: 1}})
    mocks.stream.mockImplementation(async function* () {
      yield {type: 'session.waiting', data: {wait: 'next-user-message'}} as HandleMessageStreamEvent
    })
    const firstSubmit = vi.fn()
    const user = userEvent.setup()
    render(<EveChatSession chatId="chat-1" onFirstSubmit={firstSubmit} />)

    const composer = await screen.findByLabelText('Message Ask Penge')
    await user.type(composer, '  what should I do here?  ')
    await user.click(screen.getByRole('button', {name: 'Send message'}))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({message: 'what should I do here?', clientContext: {currentPage: 'transactions'}, signal: expect.any(AbortSignal)}))
    expect(firstSubmit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('what should I do here?')).not.toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return {promise, resolve, reject}
}
