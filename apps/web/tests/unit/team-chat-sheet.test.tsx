// @vitest-environment jsdom
import React from 'react'
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const flueAgent = vi.hoisted(() => ({
  messages: [] as Array<{id: string; role: string; parts: Array<{type: string; text?: string; state?: string}>}>,
  status: 'idle',
  error: null as Error | null,
  sendMessage: vi.fn(async () => undefined),
}))

vi.mock('@flue/react', () => ({
  useFlueAgent: vi.fn(() => flueAgent),
}))

import {useFlueAgent} from '@flue/react'
import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {TeamChatSheet} from '@/components/flue/team-chat-sheet'

describe('TeamChatSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flueAgent.messages = [
      {id: 'm1', role: 'user', parts: [{type: 'text', text: 'What needs review?'}]},
      {id: 'm2', role: 'assistant', parts: [{type: 'text', text: 'Three transactions need review.'}]},
    ]
    flueAgent.status = 'idle'
    flueAgent.error = null
    flueAgent.sendMessage.mockResolvedValue(undefined)
  })

  it('opens an inline chat panel and renders text message parts without a dialog overlay', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const panel = screen.getByRole('complementary', {name: 'Ask Penge chat'})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(panel).getByText('Ask Penge')).toBeInTheDocument()
    expect(within(panel).getByText('What needs review?')).toBeInTheDocument()
    expect(within(panel).getByText('Three transactions need review.')).toBeInTheDocument()
    expect(useFlueAgent).toHaveBeenCalledWith(expect.objectContaining({name: 'team-data-assistant', live: 'sse', history: 20}))
  })

  it('renders simple markdown formatting in chat messages', async () => {
    flueAgent.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [{type: 'text', text: 'A **bold** answer with `code`.\n\n- First item\n- Second item\n\n[Open docs](https://example.com/docs)\n\n```ts\nconst amount = 100\n```'}],
      },
    ]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const panel = screen.getByRole('complementary', {name: 'Ask Penge chat'})
    expect(within(panel).getByText('bold').tagName).toBe('STRONG')
    expect(within(panel).getByText('code').tagName).toBe('CODE')
    expect(within(panel).getByRole('list')).toBeInTheDocument()
    expect(within(panel).getByText('First item').tagName).toBe('LI')
    expect(within(panel).getByRole('link', {name: 'Open docs'})).toHaveAttribute('href', 'https://example.com/docs')
    expect(within(panel).getByText(/const amount = 100/).tagName).toBe('CODE')
  })

  it('closes the inline panel from the chat header', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    expect(screen.getByRole('complementary', {name: 'Ask Penge chat'})).toBeInTheDocument()

    await user.click(screen.getByRole('button', {name: 'Close chat'}))

    expect(screen.queryByRole('complementary', {name: 'Ask Penge chat'})).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Ask Penge'})).toBeEnabled()
  })

  it('starts a fresh chat id when clearing the chat', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const useFlueAgentMock = vi.mocked(useFlueAgent)
    const initialId = useFlueAgentMock.mock.calls.at(-1)?.[0].id
    await user.click(screen.getByRole('button', {name: 'Clear chat'}))

    await waitFor(() => expect(useFlueAgentMock.mock.calls.at(-1)?.[0].id).not.toBe(initialId))
    const nextScope = decodeTeamDataAssistantId(useFlueAgentMock.mock.calls.at(-1)?.[0].id ?? '')
    const initialScope = decodeTeamDataAssistantId(initialId ?? '')
    expect(nextScope).toMatchObject({teamId: 'team-1', userId: 'user-1'})
    expect(nextScope?.chatId).toBeTruthy()
    expect(nextScope?.chatId).not.toBe(initialScope?.chatId)
  })

  it('sends trimmed input and clears the composer', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.type(screen.getByLabelText('Message Ask Penge'), '  hello assistant  ')
    await user.click(screen.getByRole('button', {name: 'Send message'}))

    expect(flueAgent.sendMessage).toHaveBeenCalledWith('hello assistant')
    expect(screen.getByLabelText('Message Ask Penge')).toHaveValue('')
  })

  it('shows friendly agent activity status inline in the chat transcript', async () => {
    flueAgent.status = 'submitted'
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Penge is thinking…')).toBeInTheDocument()
  })

  it('shows working status for non-text streaming activity', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available'}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Penge is working…')).toBeInTheDocument()
    expect(within(transcript).queryByText('Penge is responding…')).not.toBeInTheDocument()
  })

  it('shows responding status when assistant text is streaming', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'text', text: 'Looking', state: 'streaming'}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Penge is responding…')).toBeInTheDocument()
  })

  it('shows error status inline and disables empty sends', async () => {
    flueAgent.status = 'error'
    flueAgent.error = new Error('stream failed')
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('stream failed')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Send message'})).toBeDisabled()
  })
})
