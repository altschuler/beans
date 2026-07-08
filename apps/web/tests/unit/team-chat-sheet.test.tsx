// @vitest-environment jsdom
import React from 'react'
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const flueMocks = vi.hoisted(() => {
  const flueAgent = {
    messages: [] as Array<{id: string; role: string; parts: Array<{type: string; text?: string; state?: string; toolName?: string}>}>,
    status: 'idle',
    error: null as Error | null,
    sendMessage: vi.fn<(message: string) => Promise<void>>(async () => undefined),
    failedSends: [] as Array<{id: string; message: string; error: unknown}>,
  }
  const flueClient = {
    agents: {
      abort: vi.fn(async () => ({aborted: true})),
    },
  }
  return {flueAgent, flueClient}
})
const flueAgent = flueMocks.flueAgent

const zeroMocks = vi.hoisted(() => {
  type TeamDataAssistantChat = {id: string; teamId: string; userId: string; createdAt: number; updatedAt: number; lastUsedAt: number; firstSubmittedAt?: number | null}
  const chats: TeamDataAssistantChat[] = []
  const mutate = {
    flue: {
      createTeamDataAssistantChat: vi.fn((input: TeamDataAssistantChat) => {
        chats.push(input)
        return {server: Promise.resolve({type: 'ok'})}
      }),
      touchTeamDataAssistantChat: vi.fn((input: {chatId: string; lastUsedAt: number; firstSubmittedAt?: number}) => {
        const chat = chats.find(row => row.id === input.chatId)
        if (chat) {
          chat.lastUsedAt = input.lastUsedAt
          chat.updatedAt = input.lastUsedAt
          chat.firstSubmittedAt ??= input.firstSubmittedAt
        }
        return {server: Promise.resolve({type: 'ok'})}
      }),
    },
  }
  const zeroMutate = vi.fn((mutation: unknown) => mutation)
  return {chats, mutate, zeroMutate}
})

vi.mock('@flue/react', () => ({
  useFlueAgent: vi.fn(() => flueMocks.flueAgent),
  useFlueClient: vi.fn(() => flueMocks.flueClient),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {teamId?: string; userId?: string}) => [
    zeroMocks.chats
      .filter(chat => chat.teamId === query.teamId && chat.userId === query.userId)
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt),
    {type: 'complete'},
  ]),
  useZero: vi.fn(() => ({mutate: zeroMocks.zeroMutate})),
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    flue: {
      createTeamDataAssistantChat: vi.fn((input) => zeroMocks.mutate.flue.createTeamDataAssistantChat(input)),
      touchTeamDataAssistantChat: vi.fn((input) => zeroMocks.mutate.flue.touchTeamDataAssistantChat(input)),
    },
  },
}))

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      teamDataAssistantChatsByTeamUser: vi.fn((input: {teamId: string; userId: string}) => input),
    },
  },
}))

vi.mock('@/lib/run-mutation', () => ({
  runZeroMutation: vi.fn(async () => true),
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
    flueAgent.failedSends = []
    flueAgent.sendMessage.mockResolvedValue(undefined)
    flueMocks.flueClient.agents.abort.mockResolvedValue({aborted: true})
    zeroMocks.chats.splice(0)
  })

  it('opens an inline chat panel and renders text message parts without a dialog overlay', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const panel = screen.getByRole('complementary', {name: 'Ask Penge chat'})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(panel).getByText('Ask Penge')).toBeInTheDocument()
    expect(within(panel).queryByText('Personal chat for this team. Confirm categorization changes in chat before they are applied.')).not.toBeInTheDocument()
    expect(within(panel).getByText('What needs review?')).toBeInTheDocument()
    expect(within(panel).getByText('Three transactions need review.')).toBeInTheDocument()
    expect(useFlueAgent).toHaveBeenCalledWith(expect.objectContaining({name: 'team-data-assistant', live: 'sse'}))
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

  it('resumes the latest durable chat for the same user and team when it is less than one hour old', async () => {
    zeroMocks.chats.push(
      makeChat({id: 'older-chat', teamId: 'team-1', userId: 'user-1', lastUsedAt: Date.now() - 10 * 60 * 1000}),
      makeChat({id: 'recent-chat', teamId: 'team-1', userId: 'user-1', lastUsedAt: Date.now() - 5 * 60 * 1000}),
    )

    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await waitFor(() => expect(latestConversationScope()?.chatId).toBe('recent-chat'))
    expect(zeroMocks.mutate.flue.createTeamDataAssistantChat).not.toHaveBeenCalled()
  })

  it('starts and stores a new durable chat when the latest prior chat is at least one hour old', async () => {
    zeroMocks.chats.push(makeChat({id: 'stale-chat', teamId: 'team-1', userId: 'user-1', lastUsedAt: Date.now() - 61 * 60 * 1000}))
    const user = userEvent.setup()

    render(<TeamChatSheet teamId="team-1" userId="user-1" />)
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    await waitFor(() => expect(zeroMocks.mutate.flue.createTeamDataAssistantChat).toHaveBeenCalled())
    const created = zeroMocks.mutate.flue.createTeamDataAssistantChat.mock.calls.at(-1)?.[0]
    const scope = latestConversationScope()
    expect(created).toMatchObject({teamId: 'team-1', userId: 'user-1'})
    expect(scope).toMatchObject({teamId: 'team-1', userId: 'user-1', chatId: created?.id})
    expect(scope?.chatId).not.toBe('stale-chat')
  })

  it('uses separate durable chat history for different teams and users', async () => {
    zeroMocks.chats.push(
      makeChat({id: 'team-1-user-1-chat', teamId: 'team-1', userId: 'user-1'}),
      makeChat({id: 'team-2-user-1-chat', teamId: 'team-2', userId: 'user-1'}),
      makeChat({id: 'team-1-user-2-chat', teamId: 'team-1', userId: 'user-2'}),
    )
    const {rerender} = render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await waitFor(() => expect(latestConversationScope()?.chatId).toBe('team-1-user-1-chat'))

    rerender(<TeamChatSheet teamId="team-2" userId="user-1" />)
    await waitFor(() => expect(latestConversationScope()).toMatchObject({teamId: 'team-2', userId: 'user-1', chatId: 'team-2-user-1-chat'}))

    rerender(<TeamChatSheet teamId="team-1" userId="user-2" />)
    await waitFor(() => expect(latestConversationScope()).toMatchObject({teamId: 'team-1', userId: 'user-2', chatId: 'team-1-user-2-chat'}))
  })

  it('starts and stores a fresh durable chat when clearing the chat', async () => {
    zeroMocks.chats.push(makeChat({id: 'recent-chat', teamId: 'team-1', userId: 'user-1'}))
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await waitFor(() => expect(latestConversationScope()?.chatId).toBe('recent-chat'))
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.click(screen.getByRole('button', {name: 'Clear chat'}))

    await waitFor(() => expect(zeroMocks.mutate.flue.createTeamDataAssistantChat).toHaveBeenCalled())
    const created = zeroMocks.mutate.flue.createTeamDataAssistantChat.mock.calls.at(-1)?.[0]
    expect(latestConversationScope()).toMatchObject({teamId: 'team-1', userId: 'user-1', chatId: created?.id})
    expect(created?.id).not.toBe('recent-chat')
  })

  it('switches to a selected submitted durable chat from the history list', async () => {
    zeroMocks.chats.push(
      makeChat({id: 'recent-chat', teamId: 'team-1', userId: 'user-1', lastUsedAt: Date.now() - 5 * 60 * 1000, firstSubmittedAt: Date.now() - 5 * 60 * 1000}),
      makeChat({id: 'older-chat', teamId: 'team-1', userId: 'user-1', lastUsedAt: Date.now() - 30 * 60 * 1000, firstSubmittedAt: Date.now() - 30 * 60 * 1000}),
      makeChat({id: 'empty-chat', teamId: 'team-1', userId: 'user-1', lastUsedAt: Date.now() - 20 * 60 * 1000, firstSubmittedAt: null}),
    )
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await waitFor(() => expect(latestConversationScope()?.chatId).toBe('recent-chat'))
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.click(screen.getByRole('button', {name: 'History'}))
    const history = screen.getByRole('list', {name: 'Ask Penge chat history'})
    expect(within(history).getAllByRole('button')).toHaveLength(2)

    await user.click(within(history).getAllByRole('button')[1]!)

    await waitFor(() => expect(latestConversationScope()?.chatId).toBe('older-chat'))
    expect(zeroMocks.mutate.flue.touchTeamDataAssistantChat).toHaveBeenCalledWith(expect.objectContaining({chatId: 'older-chat'}))
  })

  it('renders the composer as a one-row autosizing input beside the send button', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const input = screen.getByLabelText('Message Ask Penge') as HTMLTextAreaElement
    const sendButton = screen.getByRole('button', {name: 'Send message'})
    expect(sendButton).not.toHaveTextContent('Send')
    const form = input.closest('form')
    expect(form).toHaveClass('flex')
    expect(input.compareDocumentPosition(sendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(input).toHaveAttribute('rows', '1')
    expect(input).toHaveAttribute('placeholder', 'Ask...')
    expect(input).toHaveClass('min-h-9')

    Object.defineProperty(input, 'scrollHeight', {configurable: true, value: 84})
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({borderTopWidth: '1px', borderBottomWidth: '1px'} as CSSStyleDeclaration)
    try {
      fireEvent.change(input, {target: {value: 'first line\nsecond line'}})

      expect(input.style.height).toBe('86px')
    } finally {
      getComputedStyle.mockRestore()
    }
  })

  it('submits the composer on Enter', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.type(screen.getByLabelText('Message Ask Penge'), 'hello assistant')
    fireEvent.keyDown(screen.getByLabelText('Message Ask Penge'), {key: 'Enter', code: 'Enter', charCode: 13})

    await waitFor(() => expect(flueAgent.sendMessage).toHaveBeenCalledWith('hello assistant'))
    expect(screen.getByLabelText('Message Ask Penge')).toHaveValue('')
  })

  it('keeps Shift+Enter as a composer newline', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const input = screen.getByLabelText('Message Ask Penge')
    await user.type(input, 'first line')
    await user.keyboard('{Shift>}{Enter}{/Shift}second line')

    expect(input).toHaveValue('first line\nsecond line')
    expect(flueAgent.sendMessage).not.toHaveBeenCalled()
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

  it('recovers from rejected sends and shows the failed send error', async () => {
    const user = userEvent.setup()
    const sendError = new Error('Message was not accepted')
    flueAgent.sendMessage.mockImplementation(async (message: string) => {
      flueAgent.messages = [...flueAgent.messages, {id: 'failed-send', role: 'user', parts: [{type: 'text', text: message}]}]
      flueAgent.failedSends = [{id: 'failed-send', message, error: sendError}]
      throw sendError
    })
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const input = screen.getByLabelText('Message Ask Penge')
    const sendButton = screen.getByRole('button', {name: 'Send message'})
    await user.type(input, 'will fail')
    await user.click(sendButton)

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    await waitFor(() => expect(within(transcript).getByText('Message was not accepted')).toBeInTheDocument())
    expect(within(transcript).getByText('will fail')).toBeInTheDocument()
    expect(within(transcript).queryByText('Sending…')).not.toBeInTheDocument()

    await user.type(input, 'try again')
    expect(sendButton).toBeEnabled()
  })

  it.each(['submitted', 'streaming'])('shows an icon-only stop button while the assistant is %s and aborts the current chat', async (status) => {
    flueAgent.status = status
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const conversationId = vi.mocked(useFlueAgent).mock.calls.at(-1)?.[0].id
    const stopButton = screen.getByRole('button', {name: 'Stop response'})

    expect(stopButton).not.toHaveTextContent('Send')
    expect(screen.queryByRole('button', {name: 'Send message'})).not.toBeInTheDocument()

    await user.click(stopButton)

    await waitFor(() => expect(flueMocks.flueClient.agents.abort).toHaveBeenCalledWith('team-data-assistant', conversationId))
  })

  it('renders abort failures inline instead of throwing an unhandled submit error', async () => {
    flueAgent.status = 'streaming'
    flueMocks.flueClient.agents.abort.mockRejectedValueOnce(new Error('Could not stop response'))
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.click(screen.getByRole('button', {name: 'Stop response'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(await within(transcript).findByText('Could not stop response')).toBeInTheDocument()
  })

  it('does not show a failed stop from a cleared chat in the fresh chat', async () => {
    flueAgent.status = 'streaming'
    let rejectAbort: (error: Error) => void = () => {}
    flueMocks.flueClient.agents.abort.mockImplementationOnce(async () => new Promise((_resolve, reject) => {
      rejectAbort = reject
    }))
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.click(screen.getByRole('button', {name: 'Stop response'}))
    await user.click(screen.getByRole('button', {name: 'Clear chat'}))
    await act(async () => rejectAbort(new Error('Old chat stop failed')))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).queryByText('Old chat stop failed')).not.toBeInTheDocument()
  })

  it('shows starting status when a chat turn is submitted', async () => {
    flueAgent.status = 'submitted'
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Starting…')).toBeInTheDocument()
  })

  it('maps known streaming tool activity to safe progress labels', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'searchBankTransactions'}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Searching transactions…')).toBeInTheDocument()
    expect(within(transcript).queryByText('searchBankTransactions')).not.toBeInTheDocument()
  })

  it('falls back to a generic safe progress label for unknown tools', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'internalExperimentalTool'}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Thinking through the request…')).toBeInTheDocument()
    expect(within(transcript).queryByText('internalExperimentalTool')).not.toBeInTheDocument()
  })

  it('shows a category-checking label for confirmed categorization writes', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'applyCategorizations'}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Checking categories…')).toBeInTheDocument()
    expect(within(transcript).queryByText('applyCategorizations')).not.toBeInTheDocument()
  })

  it.each(['applyCategorization', 'applyCategorizationSuggestion'])('shows an applying label for %s tool activity', async (toolName) => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Applying categorizations…')).toBeInTheDocument()
    expect(within(transcript).queryByText(toolName)).not.toBeInTheDocument()
  })

  it('ignores completed tool activity from prior assistant messages', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [
      {id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'output-available', toolName: 'searchBankTransactions'}]},
      {id: 'm2', role: 'assistant', parts: [{type: 'reasoning', state: 'streaming'}]},
    ]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Thinking through the request…')).toBeInTheDocument()
    expect(within(transcript).queryByText('Searching transactions…')).not.toBeInTheDocument()
  })

  it('shows writing status when assistant text is streaming', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'text', text: 'Looking', state: 'streaming'}]}]
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Writing answer…')).toBeInTheDocument()
  })

  it('keeps progress labels visible for at least 1000 ms before showing the next progress label', async () => {
    vi.useFakeTimers()
    try {
      flueAgent.status = 'streaming'
      flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'searchBankTransactions'}]}]
      const {rerender} = render(<TeamChatSheet teamId="team-1" userId="user-1" />)

      fireEvent.click(screen.getByRole('button', {name: 'Ask Penge'}))
      const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
      expect(within(transcript).getByText('Searching transactions…')).toBeInTheDocument()

      flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'getBankTransactionDetail'}]}]
      rerender(<TeamChatSheet teamId="team-1" userId="user-1" />)
      expect(within(transcript).getByText('Searching transactions…')).toBeInTheDocument()
      expect(within(transcript).queryByText('Reading transaction details…')).not.toBeInTheDocument()

      await act(async () => vi.advanceTimersByTime(999))
      expect(within(transcript).getByText('Searching transactions…')).toBeInTheDocument()

      await act(async () => vi.advanceTimersByTime(1))
      expect(within(transcript).getByText('Reading transaction details…')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows errors immediately without waiting for the progress delay', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'searchBankTransactions'}]}]
    const {rerender} = render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    fireEvent.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Searching transactions…')).toBeInTheDocument()

    flueAgent.status = 'error'
    flueAgent.error = new Error('stream failed')
    rerender(<TeamChatSheet teamId="team-1" userId="user-1" />)

    expect(within(transcript).getByText('stream failed')).toBeInTheDocument()
    expect(within(transcript).queryByText('Searching transactions…')).not.toBeInTheDocument()
  })

  it('clears progress immediately when the final answer is idle', async () => {
    flueAgent.status = 'streaming'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'dynamic-tool', state: 'input-available', toolName: 'searchBankTransactions'}]}]
    const {rerender} = render(<TeamChatSheet teamId="team-1" userId="user-1" />)

    fireEvent.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const transcript = screen.getByRole('log', {name: 'Ask Penge chat transcript'})
    expect(within(transcript).getByText('Searching transactions…')).toBeInTheDocument()

    flueAgent.status = 'idle'
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'text', text: 'Done.'}]}]
    rerender(<TeamChatSheet teamId="team-1" userId="user-1" />)

    expect(within(transcript).queryByText('Searching transactions…')).not.toBeInTheDocument()
    expect(within(transcript).getByText('Done.')).toBeInTheDocument()
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

function makeChat(overrides: {id: string; teamId?: string; userId?: string; createdAt?: number; updatedAt?: number; lastUsedAt?: number; firstSubmittedAt?: number | null}) {
  const now = Date.now()
  return {
    id: overrides.id,
    teamId: overrides.teamId ?? 'team-1',
    userId: overrides.userId ?? 'user-1',
    createdAt: overrides.createdAt ?? overrides.lastUsedAt ?? now,
    updatedAt: overrides.updatedAt ?? overrides.lastUsedAt ?? now,
    lastUsedAt: overrides.lastUsedAt ?? now,
    firstSubmittedAt: Object.hasOwn(overrides, 'firstSubmittedAt') ? overrides.firstSubmittedAt : overrides.lastUsedAt ?? now,
  }
}

function latestConversationScope() {
  return decodeTeamDataAssistantId(vi.mocked(useFlueAgent).mock.calls.at(-1)?.[0].id ?? '')
}
