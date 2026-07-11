// @vitest-environment jsdom
import React from 'react'
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const rows = vi.hoisted(() => ({
  chats: [] as Array<{id: string; teamId: string; userId: string; createdAt: number; updatedAt: number; lastUsedAt: number; firstSubmittedAt: number | null}>,
}))
const zero = vi.hoisted(() => ({
  create: vi.fn((input: (typeof rows.chats)[number]) => {
    rows.chats.push(input)
    return {server: Promise.resolve({type: 'ok'})}
  }),
  touch: vi.fn((input: {chatId: string; lastUsedAt: number; firstSubmittedAt?: number}) => {
    const chat = rows.chats.find(row => row.id === input.chatId)
    if (chat) chat.firstSubmittedAt ??= input.firstSubmittedAt ?? null
    return {server: Promise.resolve({type: 'ok'})}
  }),
  mutate: vi.fn((mutation: unknown) => mutation),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: {teamId: string; userId: string}) => [
    rows.chats.filter(chat => chat.teamId === query.teamId && chat.userId === query.userId).sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    {type: 'complete'},
  ],
  useZero: () => ({mutate: zero.mutate}),
}))
vi.mock('@/zero/queries', () => ({queries: {domain: {teamDataAssistantChatsByTeamUser: (input: unknown) => input}}}))
vi.mock('@/zero/mutators', () => ({mutators: {assistant: {
  createTeamDataAssistantChat: (input: (typeof rows.chats)[number]) => zero.create(input),
  touchTeamDataAssistantChat: (input: {chatId: string; lastUsedAt: number; firstSubmittedAt?: number}) => zero.touch(input),
}}}))
vi.mock('@/lib/run-mutation', () => ({runZeroMutation: async () => true}))
vi.mock('@/components/assistant/eve-chat-session', () => ({
  EveChatSession: ({chatId, waitForChatCreation, onFirstSubmit}: {chatId: string; waitForChatCreation?: boolean; onFirstSubmit(): void}) => (
    <div data-testid="eve-chat-session" data-chat-id={chatId} data-wait-for-chat-creation={String(Boolean(waitForChatCreation))}>
      <label>Message Ask Penge<textarea /></label>
      <button type="button" onClick={onFirstSubmit}>Test submit</button>
    </div>
  ),
}))

import {TeamChatSheet} from '@/components/assistant/team-chat-sheet'

describe('TeamChatSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.chats.splice(0)
  })

  it('creates and opens the product chat shell without welcome or example prompts', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const panel = screen.getByRole('complementary', {name: 'Ask Penge chat'})
    await waitFor(() => expect(within(panel).getByTestId('eve-chat-session')).toBeInTheDocument())
    expect(within(panel).queryByText('Ask about transactions, categories, or what needs review.')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/example/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(panel).getByTestId('eve-chat-session')).toHaveAttribute('data-wait-for-chat-creation', 'true')
  })

  it('resumes a recent submitted chat and touches it before the first submit', async () => {
    rows.chats.push(makeChat({id: 'recent', lastUsedAt: Date.now() - 1_000}))
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    await waitFor(() => expect(screen.getByTestId('eve-chat-session')).toHaveAttribute('data-chat-id', 'recent'))
    expect(screen.getByTestId('eve-chat-session')).toHaveAttribute('data-wait-for-chat-creation', 'false')
    await user.click(screen.getByRole('button', {name: 'Test submit'}))
    expect(zero.touch).toHaveBeenCalledWith(expect.objectContaining({chatId: 'recent', firstSubmittedAt: expect.any(Number)}))
  })

  it('preserves history selection and clear-to-fresh-thread behavior', async () => {
    rows.chats.push(
      makeChat({id: 'recent', lastUsedAt: Date.now() - 1_000}),
      makeChat({id: 'older', lastUsedAt: Date.now() - 10_000}),
    )
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    await user.click(screen.getByRole('button', {name: 'History'}))
    const history = screen.getByRole('list', {name: 'Ask Penge chat history'})
    await user.click(within(history).getAllByRole('button')[1]!)
    await waitFor(() => expect(screen.getByTestId('eve-chat-session')).toHaveAttribute('data-chat-id', 'older'))

    await user.click(screen.getByRole('button', {name: 'Clear chat'}))
    await waitFor(() => expect(zero.create).toHaveBeenCalled())
    expect(screen.getByTestId('eve-chat-session')).not.toHaveAttribute('data-chat-id', 'older')
    expect(screen.getByTestId('eve-chat-session')).toHaveAttribute('data-wait-for-chat-creation', 'true')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<TeamChatSheet teamId="team-1" userId="user-1" />)
    const trigger = screen.getByRole('button', {name: 'Ask Penge'})
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('complementary', {name: 'Ask Penge chat'})).toBeInTheDocument())

    fireEvent.keyDown(document, {key: 'Escape'})
    await waitFor(() => expect(screen.queryByRole('complementary', {name: 'Ask Penge chat'})).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

function makeChat({id, lastUsedAt}: {id: string; lastUsedAt: number}) {
  return {id, teamId: 'team-1', userId: 'user-1', createdAt: lastUsedAt, updatedAt: lastUsedAt, lastUsedAt, firstSubmittedAt: lastUsedAt}
}
