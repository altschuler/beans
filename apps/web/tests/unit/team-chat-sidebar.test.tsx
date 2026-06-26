// @vitest-environment jsdom
import React from 'react'
import {render, screen, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const flueAgent = vi.hoisted(() => ({
  messages: [] as Array<{id: string; role: string; parts: Array<{type: string; text?: string; state?: string}>}>,
  status: 'idle',
  error: null as Error | null,
  sendMessage: vi.fn(async () => undefined),
}))

const queryRows = vi.hoisted(() => ({
  teams: [{id: 'team-1', name: 'Personal'}],
}))

vi.mock('@flue/react', () => ({
  useFlueAgent: vi.fn(() => flueAgent),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'teams') return [queryRows.teams, {type: 'complete'}]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
}))

vi.mock('@/zero/queries', () => ({
  queries: {domain: {teams: () => ({name: 'teams'})}},
}))

vi.mock('@/auth/client', () => ({
  authClient: {useSession: () => ({data: {user: {id: 'user-1'}}})},
}))

import {useFlueAgent} from '@flue/react'
import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {TeamChatSidebarHost, TeamChatSidebarProvider, TeamChatSidebarTrigger} from '@/components/flue/team-chat-sidebar'

describe('TeamChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryRows.teams = [{id: 'team-1', name: 'Personal'}]
    flueAgent.messages = [{id: 'm1', role: 'assistant', parts: [{type: 'text', text: 'Root chat reply'}]}]
    flueAgent.status = 'idle'
    flueAgent.error = null
    flueAgent.sendMessage.mockResolvedValue(undefined)
  })

  it('opens a root-level sidebar from any trigger and scopes chat to the current team and user', async () => {
    const user = userEvent.setup()
    render(
      <TeamChatSidebarProvider>
        <TeamChatSidebarHost>
          <section data-testid="route-content">
            <TeamChatSidebarTrigger />
            <p>Route content</p>
          </section>
        </TeamChatSidebarHost>
      </TeamChatSidebarProvider>,
    )

    expect(screen.queryByRole('complementary', {name: 'Ask Penge chat'})).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const root = screen.getByTestId('team-chat-sidebar-root')
    const content = screen.getByTestId('team-chat-sidebar-content')
    const panel = screen.getByRole('complementary', {name: 'Ask Penge chat'})
    expect(root).toContainElement(content)
    expect(root).toContainElement(panel)
    expect(within(panel).getByText('Root chat reply')).toBeInTheDocument()
    expect(content).toHaveClass('hidden')
    expect(content).toHaveClass('lg:flex')
    expect(content).toHaveClass('min-w-0')
    expect(content.className).toContain('[&>*]:flex-1')
    expect(content.className).toContain('[&>*]:min-w-0')

    const id = vi.mocked(useFlueAgent).mock.calls.at(-1)?.[0].id
    expect(decodeTeamDataAssistantId(id ?? '')).toMatchObject({teamId: 'team-1', userId: 'user-1'})
  })

  it('disables the trigger when there is no current team', () => {
    queryRows.teams = []

    render(
      <TeamChatSidebarProvider>
        <TeamChatSidebarTrigger />
      </TeamChatSidebarProvider>,
    )

    expect(screen.getByRole('button', {name: 'Ask Penge'})).toBeDisabled()
  })
})
