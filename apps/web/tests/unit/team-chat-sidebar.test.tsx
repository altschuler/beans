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

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

import {useFlueAgent} from '@flue/react'
import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {TeamChatDesktopSidebar, TeamChatSidebarHost, TeamChatSidebarProvider, TeamChatSidebarTrigger} from '@/components/flue/team-chat-sidebar'
import {SidebarProvider} from '@/components/ui/sidebar'

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

  it('renders the desktop chat as a right shadcn sidebar sibling of the mobile host', async () => {
    const user = userEvent.setup()
    const {container} = render(
      <SidebarProvider>
        <TeamChatSidebarProvider>
          <div data-testid="shell-layout">
            <main data-testid="inset">
              <TeamChatSidebarHost>
                <section data-testid="route-content">
                  <TeamChatSidebarTrigger />
                  <p>Route content</p>
                </section>
              </TeamChatSidebarHost>
            </main>
            <TeamChatDesktopSidebar />
          </div>
        </TeamChatSidebarProvider>
      </SidebarProvider>,
    )

    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    const mobileHost = screen.getByTestId('team-chat-sidebar-root')
    const inset = screen.getByTestId('inset')
    const desktopSidebar = container.querySelector('[data-testid="team-chat-desktop-sidebar"]')
    expect(desktopSidebar).toBeInTheDocument()
    expect(desktopSidebar).toHaveAttribute('data-slot', 'sidebar')
    expect(desktopSidebar).toHaveAttribute('data-side', 'right')
    expect(desktopSidebar).toHaveAttribute('data-collapsible', 'none')
    expect(desktopSidebar).toHaveClass('hidden')
    expect(desktopSidebar).toHaveClass('lg:flex')
    expect(desktopSidebar).toHaveClass('border-l')
    expect(mobileHost).not.toContainElement(desktopSidebar as HTMLElement)
    expect(inset).not.toContainElement(desktopSidebar as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the trigger as an accessible icon-only button', () => {
    render(
      <TeamChatSidebarProvider>
        <TeamChatSidebarTrigger />
      </TeamChatSidebarProvider>,
    )

    const trigger = screen.getByRole('button', {name: 'Ask Penge'})
    expect(trigger).toHaveAttribute('aria-label', 'Ask Penge')
    expect(trigger).toHaveAttribute('title', 'Ask Penge')
    expect(trigger).not.toHaveTextContent('Ask Penge')
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
