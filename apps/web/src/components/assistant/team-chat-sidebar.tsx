import {createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode} from 'react'
import {MessageCircle} from 'lucide-react'
import {useQuery} from '@rocicorp/zero/react'
import {authClient} from '@/auth/client'
import {Button} from '@/components/ui/button'
import {Sidebar} from '@/components/ui/sidebar'
import {queries} from '@/zero/queries'
import {TeamChatPanel} from './team-chat-sheet'
import {useChatDesktopLayout} from './use-chat-desktop-layout'

type TeamChatSidebarContextValue = {
  isOpen: boolean
  openChat: () => void
  closeChat: () => void
  teamId: string | null
  userId: string | null
  triggerId: string
}

const TeamChatSidebarContext = createContext<TeamChatSidebarContextValue | null>(null)

export function TeamChatSidebarProvider({children, userId}: {children: ReactNode; userId?: string | null}) {
  const [isOpen, setIsOpen] = useState(false)
  const [teams] = useQuery(queries.domain.teams())
  const session = authClient.useSession()
  const triggerId = useId()
  const teamId = teams[0]?.id ?? null
  const effectiveUserId = userId ?? session.data?.user.id ?? null
  const openChat = useCallback(() => setIsOpen(true), [])
  const closeChat = useCallback(() => {
    setIsOpen(false)
    queueMicrotask(() => document.getElementById(triggerId)?.focus())
  }, [triggerId])
  const value = useMemo(() => ({isOpen, openChat, closeChat, teamId, userId: effectiveUserId, triggerId}), [closeChat, effectiveUserId, isOpen, openChat, teamId, triggerId])
  return <TeamChatSidebarContext.Provider value={value}>{children}</TeamChatSidebarContext.Provider>
}

export function TeamChatSidebarHost({children}: {children: ReactNode}) {
  const {isOpen, closeChat, teamId, userId} = useTeamChatSidebarContext()
  const isDesktop = useChatDesktopLayout()
  return (
    <div data-testid="team-chat-sidebar-root" data-slot="team-chat-sidebar-root" className="flex h-full min-h-0 flex-col">
      <div
        data-testid="team-chat-sidebar-content"
        data-slot="team-chat-sidebar-content"
        className={isOpen ? 'hidden min-h-0 min-w-0 flex-1 overflow-hidden lg:flex [&>*]:min-w-0 [&>*]:flex-1' : 'flex min-h-0 min-w-0 flex-1 overflow-hidden [&>*]:min-w-0 [&>*]:flex-1'}
      >
        {children}
      </div>
      {!isDesktop ? <TeamChatPanel teamId={teamId} userId={userId} isOpen={isOpen} onClose={closeChat} className="lg:hidden" /> : null}
    </div>
  )
}

export function TeamChatDesktopSidebar() {
  const {isOpen, closeChat, teamId, userId} = useTeamChatSidebarContext()
  const isDesktop = useChatDesktopLayout()
  if (!isOpen || !isDesktop) return null
  return (
    <Sidebar side="right" collapsible="none" data-testid="team-chat-desktop-sidebar" data-side="right" data-collapsible="none" className="sticky top-0 hidden h-svh w-96 shrink-0 border-l lg:flex">
      <TeamChatPanel teamId={teamId} userId={userId} isOpen={isOpen} onClose={closeChat} className="border-0 bg-sidebar lg:w-full" />
    </Sidebar>
  )
}

export function TeamChatSidebarTrigger() {
  const {isOpen, openChat, teamId, userId, triggerId} = useTeamChatSidebarContext()
  return (
    <Button id={triggerId} type="button" variant="outline" size="icon" disabled={!teamId || !userId} aria-label="Ask Penge" title="Ask Penge" aria-expanded={isOpen} onClick={openChat}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}

function useTeamChatSidebarContext() {
  const context = useContext(TeamChatSidebarContext)
  if (!context) throw new Error('TeamChatSidebar components must be rendered inside TeamChatSidebarProvider')
  return context
}
