import {useCallback, useEffect, useId, useState, type ReactNode} from 'react'
import {History, MessageCircle, X} from 'lucide-react'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {Button} from '@/components/ui/button'
import {runZeroMutation} from '@/lib/run-mutation'
import {cn} from '@/lib/utils'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {EveChatSession} from './eve-chat-session'

type TeamChatSheetProps = {
  teamId: string | null
  userId: string | null
  children?: (panel: {trigger: ReactNode; panel: ReactNode; isOpen: boolean}) => ReactNode
}

export type TeamChatPanelProps = {
  teamId: string | null
  userId: string | null
  isOpen: boolean
  onClose: () => void
  className?: string
}

type SelectedTeamChat = {id: string; teamId: string; userId: string}

const pendingChatScopeSentinel = '__pending_chat_scope__'
const recentChatResumeWindowMs = 60 * 60 * 1000

export function TeamChatSheet({teamId, userId, children}: TeamChatSheetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerId = useId()
  const close = () => {
    setIsOpen(false)
    queueMicrotask(() => document.getElementById(triggerId)?.focus())
  }
  const trigger = (
    <Button id={triggerId} type="button" variant="outline" disabled={!teamId || !userId} aria-expanded={isOpen} onClick={() => setIsOpen(true)}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      Ask Penge
    </Button>
  )
  const panel = <TeamChatPanel teamId={teamId} userId={userId} isOpen={isOpen} onClose={close} />
  if (children) return <>{children({trigger, panel, isOpen})}</>
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
      <div className={cn('min-w-0', isOpen ? 'hidden lg:block lg:flex-1' : 'block')}>{trigger}</div>
      {panel}
    </div>
  )
}

export function TeamChatPanel({teamId, userId, isOpen, onClose, className}: TeamChatPanelProps) {
  const [showHistory, setShowHistory] = useState(false)
  const [selectedChat, setSelectedChat] = useState<SelectedTeamChat | null>(null)
  const titleId = useId()
  const zero = useZero()
  const query = teamId && userId
    ? queries.domain.teamDataAssistantChatsByTeamUser({teamId, userId})
    : queries.domain.teamDataAssistantChatsByTeamUser({teamId: pendingChatScopeSentinel, userId: pendingChatScopeSentinel})
  const [chatHistory, chatHistoryStatus] = useQuery(query)
  const submittedChats = chatHistory.filter(chat => chat.firstSubmittedAt)
  const latestChat = submittedChats[0]

  const createAndSelectNewChat = useCallback((scope: {teamId: string; userId: string}) => {
    const now = Date.now()
    const chat = {
      id: createChatId(),
      teamId: scope.teamId,
      userId: scope.userId,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      firstSubmittedAt: null,
    }
    setSelectedChat({id: chat.id, teamId: chat.teamId, userId: chat.userId})
    void runZeroMutation(zero.mutate(mutators.assistant.createTeamDataAssistantChat(chat)), 'Could not save chat history')
    return chat.id
  }, [zero])

  const touchChat = useCallback((chatId: string, submitted = false) => {
    const now = Date.now()
    void runZeroMutation(zero.mutate(mutators.assistant.touchTeamDataAssistantChat({
      chatId,
      lastUsedAt: now,
      ...(submitted ? {firstSubmittedAt: now} : {}),
    })), 'Could not update chat history')
  }, [zero])

  useEffect(() => {
    if (!teamId || !userId) {
      // Synchronize the selected product resource with the authenticated scope.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedChat(null)
      return
    }
    if (selectedChat?.teamId === teamId && selectedChat.userId === userId) return
    if (chatHistoryStatus.type !== 'complete') return
    // The resume window is intentionally evaluated only while synchronizing Zero history.
    // eslint-disable-next-line react-hooks/purity
    if (latestChat && Date.now() - latestChat.lastUsedAt < recentChatResumeWindowMs) {
      setSelectedChat({id: latestChat.id, teamId, userId})
    } else if (isOpen) {
      createAndSelectNewChat({teamId, userId})
    }
  }, [chatHistoryStatus.type, createAndSelectNewChat, isOpen, latestChat, selectedChat, teamId, userId])

  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const focusTimer = setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('[data-slot="team-chat-panel"]')
      const target = panel?.querySelector<HTMLElement>('textarea:not(:disabled)') ?? panel?.querySelector<HTMLElement>('[aria-label="Close chat"]')
      target?.focus()
    }, 0)
    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  function clearChat() {
    if (!teamId || !userId) return
    setShowHistory(false)
    createAndSelectNewChat({teamId, userId})
  }

  function selectChat(chat: SelectedTeamChat) {
    setSelectedChat(chat)
    setShowHistory(false)
    touchChat(chat.id)
  }

  return (
    <aside
      role="complementary"
      aria-label="Ask Penge chat"
      data-slot="team-chat-panel"
      className={cn('flex h-full min-h-0 w-full flex-col border-t bg-background lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l', className)}
    >
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-semibold text-foreground">Ask Penge</h2>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={submittedChats.length === 0} aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>
              <History className="h-4 w-4" aria-hidden="true" /> History
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!teamId || !userId} onClick={clearChat}>Clear chat</Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Close chat" onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
      </div>

      {showHistory ? (
        <div className="border-b bg-background p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Recent chats</div>
          <div role="list" aria-label="Ask Penge chat history" className="space-y-1">
            {submittedChats.map(chat => (
              <div key={chat.id} role="listitem">
                <button
                  type="button"
                  aria-current={selectedChat?.id === chat.id ? 'true' : undefined}
                  className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground', selectedChat?.id === chat.id ? 'bg-accent text-accent-foreground' : 'text-foreground')}
                  onClick={() => selectChat({id: chat.id, teamId: chat.teamId, userId: chat.userId})}
                >
                  <span>{formatChatDate(chat.lastUsedAt)}</span>
                  {selectedChat?.id === chat.id ? <span className="text-xs text-muted-foreground">Current</span> : null}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedChat ? <EveChatSession key={selectedChat.id} chatId={selectedChat.id} onFirstSubmit={() => touchChat(selectedChat.id, true)} /> : <div className="min-h-0 flex-1" />}
    </aside>
  )
}

function createChatId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatChatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(timestamp))
}
