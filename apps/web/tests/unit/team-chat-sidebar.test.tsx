// @vitest-environment jsdom
import React from 'react'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({teams: [{id: 'team-1'}], isDesktop: true}))
vi.mock('@rocicorp/zero/react', () => ({useQuery: () => [queryRows.teams, {type: 'complete'}]}))
vi.mock('@/zero/queries', () => ({queries: {domain: {teams: () => ({name: 'teams'})}}}))
vi.mock('@/auth/client', () => ({authClient: {useSession: () => ({data: {user: {id: 'user-1'}}})}}))
vi.mock('@/components/assistant/use-chat-desktop-layout', () => ({useChatDesktopLayout: () => queryRows.isDesktop}))
vi.mock('@/hooks/use-mobile', () => ({useIsMobile: () => !queryRows.isDesktop}))
vi.mock('@/components/assistant/team-chat-sheet', () => ({
  TeamChatPanel: ({isOpen, onClose}: {isOpen: boolean; onClose(): void}) => isOpen ? <aside aria-label="Ask Penge chat"><button onClick={onClose}>Close chat</button></aside> : null,
}))

import {TeamChatDesktopSidebar, TeamChatSidebarHost, TeamChatSidebarProvider, TeamChatSidebarTrigger} from '@/components/assistant/team-chat-sidebar'
import {SidebarProvider} from '@/components/ui/sidebar'

describe('TeamChatSidebar', () => {
  beforeEach(() => {
    queryRows.teams = [{id: 'team-1'}]
    queryRows.isDesktop = true
  })

  it('opens the root-level mobile host and preserves the responsive route layout', async () => {
    queryRows.isDesktop = false
    const user = userEvent.setup()
    render(
      <TeamChatSidebarProvider>
        <TeamChatSidebarHost><main><TeamChatSidebarTrigger />Route content</main></TeamChatSidebarHost>
      </TeamChatSidebarProvider>,
    )
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))

    expect(screen.getAllByRole('complementary', {name: 'Ask Penge chat'})).toHaveLength(1)
    expect(screen.getByTestId('team-chat-sidebar-content')).toHaveClass('hidden', 'lg:flex', 'min-w-0')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the desktop panel as a right shadcn sidebar sibling', async () => {
    const user = userEvent.setup()
    const {container} = render(
      <SidebarProvider>
        <TeamChatSidebarProvider>
          <main><TeamChatSidebarHost><TeamChatSidebarTrigger /></TeamChatSidebarHost></main>
          <TeamChatDesktopSidebar />
        </TeamChatSidebarProvider>
      </SidebarProvider>,
    )
    await user.click(screen.getByRole('button', {name: 'Ask Penge'}))
    const sidebar = container.querySelector('[data-testid="team-chat-desktop-sidebar"]')
    expect(screen.getAllByRole('complementary', {name: 'Ask Penge chat'})).toHaveLength(1)
    expect(sidebar).toHaveAttribute('data-side', 'right')
    expect(sidebar).toHaveClass('hidden', 'lg:flex', 'border-l')
  })

  it('keeps the icon trigger accessible and restores its focus after closing', async () => {
    queryRows.isDesktop = false
    const user = userEvent.setup()
    render(
      <TeamChatSidebarProvider>
        <TeamChatSidebarTrigger />
        <TeamChatSidebarHost><main /></TeamChatSidebarHost>
      </TeamChatSidebarProvider>,
    )
    const trigger = screen.getByRole('button', {name: 'Ask Penge'})
    expect(trigger).toHaveAttribute('title', 'Ask Penge')
    expect(trigger).not.toHaveTextContent('Ask Penge')
    await user.click(trigger)
    await user.click(screen.getByRole('button', {name: 'Close chat'}))
    await vi.waitFor(() => expect(trigger).toHaveFocus())
  })

  it('disables the trigger without a current team', () => {
    queryRows.teams = []
    render(<TeamChatSidebarProvider><TeamChatSidebarTrigger /></TeamChatSidebarProvider>)
    expect(screen.getByRole('button', {name: 'Ask Penge'})).toBeDisabled()
  })
})
