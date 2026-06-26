import {createContext, useContext, useMemo, useState, type ReactNode} from 'react'
import {MessageCircle} from 'lucide-react'
import {useQuery} from '@rocicorp/zero/react'
import {authClient} from '@/auth/client'
import {TeamChatPanel} from '@/components/flue/team-chat-sheet'
import {Button} from '@/components/ui/button'
import {Sidebar} from '@/components/ui/sidebar'
import {queries} from '@/zero/queries'

type TeamChatSidebarContextValue = {
  isOpen: boolean
  openChat: () => void
  closeChat: () => void
  teamId: string | null
  userId: string | null
}

const TeamChatSidebarContext = createContext<TeamChatSidebarContextValue | null>(null)

type TeamChatSidebarProviderProps = {
  children: ReactNode
  userId?: string | null
}

export function TeamChatSidebarProvider({children, userId}: TeamChatSidebarProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [teams] = useQuery(queries.domain.teams())
  const session = authClient.useSession()
  const teamId = teams[0]?.id ?? null
  const effectiveUserId = userId ?? session.data?.user.id ?? null
  const value = useMemo<TeamChatSidebarContextValue>(
    () => ({
      isOpen,
      openChat: () => setIsOpen(true),
      closeChat: () => setIsOpen(false),
      teamId,
      userId: effectiveUserId,
    }),
    [effectiveUserId, isOpen, teamId],
  )

  return <TeamChatSidebarContext.Provider value={value}>{children}</TeamChatSidebarContext.Provider>
}

export function TeamChatSidebarHost({children}: {children: ReactNode}) {
  const {isOpen, closeChat, teamId, userId} = useTeamChatSidebarContext()

  return (
    <div data-testid="team-chat-sidebar-root" data-slot="team-chat-sidebar-root" className="flex h-full min-h-0 flex-col">
      <div
        data-testid="team-chat-sidebar-content"
        data-slot="team-chat-sidebar-content"
        className={isOpen ? 'hidden min-h-0 min-w-0 flex-1 overflow-hidden lg:flex [&>*]:min-w-0 [&>*]:flex-1' : 'flex min-h-0 min-w-0 flex-1 overflow-hidden [&>*]:min-w-0 [&>*]:flex-1'}
      >
        {children}
      </div>
      <TeamChatPanel teamId={teamId} userId={userId} isOpen={isOpen} onClose={closeChat} className="lg:hidden" />
    </div>
  )
}

export function TeamChatDesktopSidebar() {
  const {isOpen, closeChat, teamId, userId} = useTeamChatSidebarContext()
  if (!isOpen) return null

  return (
    <Sidebar
      side="right"
      collapsible="none"
      data-testid="team-chat-desktop-sidebar"
      data-side="right"
      data-collapsible="none"
      className="sticky top-0 hidden h-svh w-96 shrink-0 border-l lg:flex"
    >
      <TeamChatPanel teamId={teamId} userId={userId} isOpen={isOpen} onClose={closeChat} className="border-0 bg-sidebar lg:w-full" />
    </Sidebar>
  )
}

export function TeamChatSidebarTrigger() {
  const {isOpen, openChat, teamId, userId} = useTeamChatSidebarContext()
  const canOpen = Boolean(teamId && userId)

  return (
    <Button type="button" variant="outline" size="icon" disabled={!canOpen} aria-label="Ask Penge" title="Ask Penge" aria-expanded={isOpen} onClick={openChat}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}

function useTeamChatSidebarContext() {
  const context = useContext(TeamChatSidebarContext)
  if (!context) throw new Error('TeamChatSidebar components must be rendered inside TeamChatSidebarProvider')
  return context
}
