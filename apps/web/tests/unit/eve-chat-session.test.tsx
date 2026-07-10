// @vitest-environment jsdom
import React from 'react'
import {render, screen} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import type {HandleMessageStreamEvent} from 'eve/client'
import {
  areChatEventsCaughtUp,
  createEveChatClientSession,
  projectEveChatEvents,
  toOrderedUniqueChatEvents,
} from '@/components/assistant/eve-chat-event-adapter'

const event = (type: HandleMessageStreamEvent['type'], data?: unknown) => ({
  type,
  ...(data === undefined ? {} : {data}),
}) as HandleMessageStreamEvent

describe('Eve chat session adapter', () => {
  it('waits for the required Zero cursor and orders/deduplicates replay across ordinals', () => {
    const rows = [
      {sessionOrdinal: 2, streamIndex: 1, event: event('session.completed')},
      {sessionOrdinal: 1, streamIndex: 1, event: event('session.waiting', {wait: 'next-user-message'})},
      {sessionOrdinal: 1, streamIndex: 0, event: event('session.started', {data: {}})},
      {sessionOrdinal: 2, streamIndex: 0, event: event('session.started', {data: {}})},
      {sessionOrdinal: 2, streamIndex: 0, event: event('session.started', {data: {}})},
    ]

    expect(areChatEventsCaughtUp(rows.filter(row => row.streamIndex === 1), {sessionOrdinal: 2, streamIndex: 2}, true)).toBe(false)
    expect(areChatEventsCaughtUp(rows, {sessionOrdinal: 2, streamIndex: 2}, true)).toBe(true)
    expect(toOrderedUniqueChatEvents(rows).map(row => `${row.sessionOrdinal}:${row.streamIndex}`)).toEqual([
      '1:0', '1:1', '2:0', '2:1',
    ])
  })

  it('constructs a public Eve client session against the same-origin chat proxy', () => {
    const session = createEveChatClientSession('chat / one', {
      sessionId: 'session-1',
      continuationToken: 'continuation-1',
      streamIndex: 4,
    })

    expect(session.state).toEqual({sessionId: 'session-1', continuationToken: 'continuation-1', streamIndex: 4})
  })

  it('uses Eve 0.22.1 public default reducer for sanitized hydration compatibility', () => {
    const projected = projectEveChatEvents([
      event('message.received', {message: 'Hello', parts: [{type: 'text', text: 'Hello'}], sequence: 1, turnId: 'turn-1'}),
      event('message.completed', {message: 'Hi there', finishReason: 'stop', sequence: 1, stepIndex: 0, turnId: 'turn-1'}),
      event('session.waiting', {wait: 'next-user-message'}),
    ])

    expect(projected.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({role: 'user', parts: expect.arrayContaining([expect.objectContaining({type: 'text', text: 'Hello'})])}),
      expect.objectContaining({role: 'assistant', parts: expect.arrayContaining([expect.objectContaining({type: 'text', text: 'Hi there'})])}),
    ]))
  })

  it('renders only shared server-guidance sitemap links', async () => {
    const {EveChatTranscript} = await import('@/components/assistant/eve-chat-session')
    const {MessageScroller, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport} = await import('@/components/ui/message-scroller')
    render(<MessageScrollerProvider><MessageScroller><MessageScrollerViewport><MessageScrollerContent>
      <EveChatTranscript messages={[{id: 'assistant-1', role: 'assistant', parts: [{type: 'text', text: '[Transactions](/app/transactions) [Unsafe](https://evil.invalid)', state: 'done'}]}]} />
    </MessageScrollerContent></MessageScrollerViewport></MessageScroller></MessageScrollerProvider>)
    expect(screen.getByRole('link', {name: 'Transactions'})).toHaveAttribute('href', '/app/transactions')
    expect(screen.queryByRole('link', {name: 'Unsafe'})).not.toBeInTheDocument()
  })

  it('does not render file or authorization media from reducer parts', async () => {
    const {EveChatTranscript} = await import('@/components/assistant/eve-chat-session')
    const {MessageScroller, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport} = await import('@/components/ui/message-scroller')
    render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent>
              <EveChatTranscript messages={[{
                id: 'assistant-1',
                role: 'assistant',
                parts: [
                  {type: 'file', mediaType: 'image/png', url: 'https://evil.invalid/image.png'},
                  {type: 'authorization', state: 'required', name: 'unsafe', displayName: 'Unsafe', description: 'Unsafe', stepIndex: 0, turnId: 'turn-1', authorization: {url: 'https://evil.invalid'}},
                  {type: 'text', text: 'Safe answer', state: 'done'},
                ],
              }]} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>,
    )

    expect(screen.getByText('Safe answer')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('evil.invalid')
  })
})
