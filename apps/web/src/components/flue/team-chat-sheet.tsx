import {useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode} from 'react'
import {ArrowUp, History, MessageCircle, Sparkles, Square, X} from 'lucide-react'
import ReactMarkdown, {type Components} from 'react-markdown'
import {useRouterState} from '@tanstack/react-router'
import {useFlueAgent, useFlueClient, type FlueConversationMessage, type FlueConversationPart} from '@flue/react'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {encodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {type TeamChatPageKey} from '@penge/domain/team-chat-ui-context'
import {Bubble, BubbleContent} from '@/components/ui/bubble'
import {Button} from '@/components/ui/button'
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from '@/components/ui/empty'
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea} from '@/components/ui/input-group'
import {Marker, MarkerContent, MarkerIcon} from '@/components/ui/marker'
import {Message, MessageContent} from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import {Spinner} from '@/components/ui/spinner'
import {runZeroMutation} from '@/lib/run-mutation'
import {cn} from '@/lib/utils'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {getTeamChatClientContextForPathname, setLatestTeamChatClientContext} from './team-chat-ui-context'

type TeamChatSheetProps = {
  teamId: string | null
  userId: string | null
  children?: (panel: TeamChatPanelRenderProps) => ReactNode
}

type TeamChatPanelRenderProps = {
  trigger: ReactNode
  panel: ReactNode
  isOpen: boolean
}

export type TeamChatPanelProps = {
  teamId: string | null
  userId: string | null
  isOpen: boolean
  onClose: () => void
  className?: string
}

type SelectedTeamChat = {
  id: string
  teamId: string
  userId: string
}

const pendingChatScopeSentinel = '__pending_chat_scope__'
const recentChatResumeWindowMs = 60 * 60 * 1000

export function TeamChatSheet({teamId, userId, children}: TeamChatSheetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const canOpen = Boolean(teamId && userId)
  const trigger = (
    <Button type="button" variant="outline" disabled={!canOpen} aria-expanded={isOpen} onClick={() => setIsOpen(true)}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      Ask Penge
    </Button>
  )
  const panel = <TeamChatPanel teamId={teamId} userId={userId} isOpen={isOpen} onClose={() => setIsOpen(false)} />

  if (children) return <>{children({trigger, panel, isOpen})}</>

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
      <div className={cn('min-w-0', isOpen ? 'hidden lg:block lg:flex-1' : 'block')}>{trigger}</div>
      {panel}
    </div>
  )
}

export function TeamChatPanel({teamId, userId, isOpen, onClose, className}: TeamChatPanelProps) {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [abortError, setAbortError] = useState<Error | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedChat, setSelectedChat] = useState<SelectedTeamChat | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const chatQuery = teamId && userId ? queries.domain.teamDataAssistantChatsByTeamUser({teamId, userId}) : queries.domain.teamDataAssistantChatsByTeamUser({teamId: pendingChatScopeSentinel, userId: pendingChatScopeSentinel})
  const [chatHistory, chatHistoryStatus] = useQuery(chatQuery)
  const zero = useZero()
  const pathname = useRouterState({select: state => state.location.pathname})
  const clientContext = useMemo(() => getTeamChatClientContextForPathname(pathname), [pathname])
  const currentPage = clientContext.currentPage ?? null
  const conversationId = useMemo(() => (teamId && userId && selectedChat?.teamId === teamId && selectedChat.userId === userId ? encodeTeamDataAssistantId({teamId, userId, chatId: selectedChat.id}) : undefined), [selectedChat, teamId, userId])
  const currentConversationIdRef = useRef(conversationId)
  const stopRequestIdRef = useRef(0)
  const flueClient = useFlueClient()
  const agent = useFlueAgent({name: 'team-data-assistant', id: conversationId, live: 'sse'})
  const isAgentWorking = isAbortableAgentStatus(agent.status)
  const canSend = Boolean(conversationId && input.trim() && !isSubmitting && !isAgentWorking)
  const canStop = Boolean(conversationId && isAgentWorking && !isStopping)
  const messages = agent.messages
  const latestFailedSendError = agent.failedSends.at(-1)?.error
  const activity = useStableChatActivity(getChatActivity({status: agent.status, error: abortError ?? agent.error ?? latestFailedSendError, isSubmitting, isStopping, messages}))
  const submittedChatHistory = chatHistory.filter(chat => chat.firstSubmittedAt)
  const latestChat = submittedChatHistory[0]
  const chatHistoryComplete = chatHistoryStatus.type === 'complete'

  const createAndSelectNewChat = useCallback((scope: {teamId: string; userId: string}) => {
    const now = Date.now()
    const chat = {id: createChatId(), teamId: scope.teamId, userId: scope.userId, createdAt: now, updatedAt: now, lastUsedAt: now, firstSubmittedAt: null}
    setSelectedChat({id: chat.id, teamId: chat.teamId, userId: chat.userId})
    void runZeroMutation(zero.mutate(mutators.flue.createTeamDataAssistantChat(chat)), 'Could not save chat history')
    return chat.id
  }, [zero])

  const touchChat = useCallback((chatId: string, options: {submitted?: boolean; currentPage?: TeamChatPageKey | null} = {}) => {
    const now = Date.now()
    void runZeroMutation(
      zero.mutate(mutators.flue.touchTeamDataAssistantChat({
        chatId,
        lastUsedAt: now,
        ...(options.submitted ? {firstSubmittedAt: now} : {}),
        ...(Object.hasOwn(options, 'currentPage') ? {currentPage: options.currentPage} : {}),
      })),
      'Could not update chat history',
    )
  }, [zero])

  useEffect(() => {
    currentConversationIdRef.current = conversationId
  }, [conversationId])

  useEffect(() => {
    setLatestTeamChatClientContext(clientContext)
  }, [clientContext])

  useEffect(() => {
    if (!selectedChat || selectedChat.teamId !== teamId || selectedChat.userId !== userId) return
    touchChat(selectedChat.id, {currentPage})
  }, [currentPage, selectedChat, teamId, touchChat, userId])

  useEffect(() => {
    if (!teamId || !userId) {
      // This effect synchronizes selected chat state to the current authenticated scope.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedChat(null)
      return
    }

    if (selectedChat?.teamId === teamId && selectedChat.userId === userId) return
    if (!chatHistoryComplete) return

    // The recency check is time-based by design; it runs only while synchronizing Zero history in this effect.
    // eslint-disable-next-line react-hooks/purity
    if (latestChat && Date.now() - latestChat.lastUsedAt < recentChatResumeWindowMs) {
      setSelectedChat({id: latestChat.id, teamId, userId})
      return
    }
    if (!isOpen) return

    createAndSelectNewChat({teamId, userId})
  }, [chatHistoryComplete, createAndSelectNewChat, isOpen, latestChat, selectedChat, teamId, userId])

  useEffect(() => {
    resizeComposer(inputRef.current)
  }, [input])

  function clearChat() {
    if (!teamId || !userId) return
    stopRequestIdRef.current += 1
    setInput('')
    setIsSubmitting(false)
    setIsStopping(false)
    setAbortError(null)
    createAndSelectNewChat({teamId, userId})
  }

  function selectChatFromHistory(chat: {id: string; teamId: string; userId: string}) {
    stopRequestIdRef.current += 1
    setInput('')
    setIsSubmitting(false)
    setIsStopping(false)
    setAbortError(null)
    setSelectedChat({id: chat.id, teamId: chat.teamId, userId: chat.userId})
    setShowHistory(false)
    touchChat(chat.id)
  }

  function updateInput(element: HTMLTextAreaElement) {
    setInput(element.value)
    resizeComposer(element)
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = input.trim()
    if (!message || !conversationId || isSubmitting || isAgentWorking) return

    setInput('')
    setAbortError(null)
    setIsSubmitting(true)
    try {
      if (selectedChat) touchChat(selectedChat.id, {submitted: true, currentPage})
      await agent.sendMessage(message)
    } catch {
      // Flue exposes send failures through agent.error/failedSends; keep the event handler settled.
    } finally {
      setIsSubmitting(false)
    }
  }

  async function stopResponse() {
    if (!conversationId || !isAgentWorking || isStopping) return

    const stoppedConversationId = conversationId
    const stopRequestId = stopRequestIdRef.current + 1
    stopRequestIdRef.current = stopRequestId
    setAbortError(null)
    setIsStopping(true)
    try {
      await flueClient.agents.abort('team-data-assistant', stoppedConversationId)
    } catch (error) {
      if (stopRequestIdRef.current === stopRequestId && currentConversationIdRef.current === stoppedConversationId) {
        setAbortError(error instanceof Error ? error : new Error('Could not stop response'))
      }
    } finally {
      if (stopRequestIdRef.current === stopRequestId && currentConversationIdRef.current === stoppedConversationId) setIsStopping(false)
    }
  }

  if (!isOpen) return null

  return (
    <aside
      role="complementary"
      aria-label="Ask Penge chat"
      data-slot="team-chat-panel"
      className={cn('flex h-full min-h-0 w-full flex-col border-t bg-background lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l', className)}
    >
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="font-semibold text-foreground">Ask Penge</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={submittedChatHistory.length === 0} aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>
              <History className="h-4 w-4" aria-hidden="true" />
              History
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!teamId || !userId} onClick={clearChat}>
              Clear chat
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Close chat" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {showHistory ? (
        <div className="border-b bg-background p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Recent chats</div>
          <div role="list" aria-label="Ask Penge chat history" className="space-y-1">
            {submittedChatHistory.map(chat => (
              <div key={chat.id} role="listitem">
                <button
                  type="button"
                  aria-current={selectedChat?.id === chat.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    selectedChat?.id === chat.id ? 'bg-accent text-accent-foreground' : 'text-foreground',
                  )}
                  onClick={() => selectChatFromHistory(chat)}
                >
                  <span>{formatChatDate(chat.lastUsedAt)}</span>
                  {selectedChat?.id === chat.id ? <span className="text-xs text-muted-foreground">Current</span> : null}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {messages.length === 0 && !activity ? (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Ask Penge</EmptyTitle>
            <EmptyDescription>Ask about transactions, categories, or what needs review.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MessageScrollerProvider key={conversationId ?? 'pending'} autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport className="p-4">
              <MessageScrollerContent className="gap-6" aria-label="Ask Penge chat transcript">
                {messages.map((message) => {
                  const text = getMessageText(message)
                  if (!text) return null

                  return (
                    <MessageScrollerItem key={message.id} messageId={message.id}>
                      <ChatMessage role={message.role}>{text}</ChatMessage>
                    </MessageScrollerItem>
                  )
                })}
                {activity ? (
                  <MessageScrollerItem messageId="activity">
                    <ChatActivityMarker activity={activity} />
                  </MessageScrollerItem>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <div className="border-t bg-background p-3">
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="team-chat-message">Message Ask Penge</label>
          <InputGroup>
            <InputGroupTextarea
              ref={inputRef}
              id="team-chat-message"
              rows={1}
              value={input}
              onChange={(event) => updateInput(event.currentTarget)}
              onKeyDown={submitOnEnter}
              placeholder="Ask about transactions, categories, or what needs review…"
              className="max-h-40 min-h-16 overflow-y-auto"
            />
            <InputGroupAddon align="block-end">
              <InputGroupButton
                type={isAgentWorking ? 'button' : 'submit'}
                variant={isAgentWorking ? 'outline' : 'default'}
                size="icon-sm"
                disabled={isAgentWorking ? !canStop : !canSend}
                aria-label={isAgentWorking ? 'Stop response' : 'Send message'}
                className="ml-auto rounded-full"
                onClick={isAgentWorking ? stopResponse : undefined}
              >
                {isAgentWorking ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </aside>
  )
}

function resizeComposer(element: HTMLTextAreaElement | null) {
  if (!element) return

  element.style.height = 'auto'
  const style = window.getComputedStyle(element)
  const verticalBorderWidth = toPixelNumber(style.borderTopWidth) + toPixelNumber(style.borderBottomWidth)
  element.style.height = `${element.scrollHeight + verticalBorderWidth}px`
}

function toPixelNumber(value: string) {
  return Number.parseFloat(value) || 0
}

function createChatId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatChatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(timestamp))
}

function getMessageText(message: FlueConversationMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}

function ChatMessage({role, children}: {role: FlueConversationMessage['role']; children: string}) {
  const isUser = role === 'user'

  return (
    <Message align={isUser ? 'end' : 'start'}>
      <MessageContent>
        <Bubble variant={isUser ? 'muted' : 'outline'}>
          <BubbleContent>
            <ChatMarkdown>{children}</ChatMarkdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

const markdownComponents = {
  p({node: _node, className, ...props}) {
    return <p className={cn('whitespace-pre-wrap leading-relaxed not-first:mt-2', className)} {...props} />
  },
  ul({node: _node, className, ...props}) {
    return <ul className={cn('my-2 list-disc space-y-1 pl-5', className)} {...props} />
  },
  ol({node: _node, className, ...props}) {
    return <ol className={cn('my-2 list-decimal space-y-1 pl-5', className)} {...props} />
  },
  li({node: _node, className, ...props}) {
    return <li className={cn('pl-1', className)} {...props} />
  },
  a({node: _node, className, ...props}) {
    return <a className={cn('underline underline-offset-2 hover:text-primary', className)} {...props} />
  },
  code({node: _node, className, ...props}) {
    return <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]', className)} {...props} />
  },
  pre({node: _node, className, ...props}) {
    return <pre className={cn('my-2 overflow-x-auto rounded-md border bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0', className)} {...props} />
  },
} satisfies Components

function ChatMarkdown({children}: {children: string}) {
  return (
    <ReactMarkdown allowedElements={['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li']} components={markdownComponents} skipHtml>
      {children}
    </ReactMarkdown>
  )
}

const progressMinimumMs = 1000

const toolProgressLabels: Record<string, string> = {
  searchBankTransactions: 'Searching transactions…',
  getBankTransactionDetail: 'Reading transaction details…',
  searchLedgerAccounts: 'Checking categories…',
  manageCategory: 'Checking categories…',
  applyCategorizations: 'Checking categories…',
  applyCategorization: 'Applying categorizations…',
  applyCategorizationSuggestion: 'Applying categorizations…',
  searchLedgerTransactions: 'Reviewing prior categorizations…',
}

type ChatActivity = {
  text: string
  tone: 'muted' | 'error'
}

function ChatActivityMarker({activity}: {activity: ChatActivity}) {
  const isError = activity.tone === 'error'

  return (
    <Marker role="status">
      {isError ? null : (
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
      )}
      <MarkerContent className={isError ? 'text-destructive' : 'shimmer'}>{activity.text}</MarkerContent>
    </Marker>
  )
}

function useStableChatActivity(activity: ChatActivity | null) {
  const [displayedActivity, setDisplayedActivity] = useState(activity)
  const shownAtRef = useRef<number | null>(null)
  const pendingActivityRef = useRef<ChatActivity | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityText = activity?.text
  const activityTone = activity?.tone

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (!activityText || activityTone === 'error') {
      pendingActivityRef.current = null
      const nextActivity = activityText ? {text: activityText, tone: activityTone ?? 'muted'} : null
      if (displayedActivity?.text !== nextActivity?.text || displayedActivity?.tone !== nextActivity?.tone) {
        shownAtRef.current = Date.now()
        // This effect intentionally synchronizes displayed progress with timer state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDisplayedActivity(nextActivity)
      }
      return
    }

    const nextActivity = {text: activityText, tone: activityTone ?? 'muted'}
    if (!displayedActivity || displayedActivity.tone === 'error' || displayedActivity.text === nextActivity.text) {
      pendingActivityRef.current = null
      if (displayedActivity?.text !== nextActivity.text || displayedActivity?.tone !== nextActivity.tone) {
        shownAtRef.current = Date.now()
        setDisplayedActivity(nextActivity)
      }
      return
    }

    const elapsed = Date.now() - (shownAtRef.current ?? Date.now())
    if (elapsed >= progressMinimumMs) {
      pendingActivityRef.current = null
      shownAtRef.current = Date.now()
      setDisplayedActivity(nextActivity)
      return
    }

    pendingActivityRef.current = nextActivity
    timeoutRef.current = setTimeout(() => {
      const pendingActivity = pendingActivityRef.current
      if (!pendingActivity) return

      pendingActivityRef.current = null
      timeoutRef.current = null
      shownAtRef.current = Date.now()
      setDisplayedActivity(pendingActivity)
    }, progressMinimumMs - elapsed)
  }, [activityText, activityTone, displayedActivity])

  return displayedActivity
}

function isAbortableAgentStatus(status?: string) {
  return status === 'submitted' || status === 'streaming'
}

function getChatActivity({status, error, isSubmitting, isStopping, messages}: {status?: string; error?: unknown; isSubmitting: boolean; isStopping: boolean; messages: FlueConversationMessage[]}): ChatActivity | null {
  const errorText = getErrorText(error)
  if (errorText) return {text: errorText, tone: 'error'}
  if (isStopping) return {text: 'Stopping…', tone: 'muted'}
  if (isSubmitting) return {text: 'Sending…', tone: 'muted'}
  if (status === 'connecting') return {text: 'Connecting to Penge…', tone: 'muted'}
  if (status === 'submitted') return {text: 'Starting…', tone: 'muted'}
  if (status === 'streaming') return {text: getStreamingActivityText(messages), tone: 'muted'}
  if (status && status !== 'idle') return {text: 'Thinking through the request…', tone: 'muted'}
  return null
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return null
}

function getStreamingActivityText(messages: FlueConversationMessage[]) {
  const latestAssistantMessage = getLatestAssistantMessage(messages)
  if (!latestAssistantMessage) return 'Thinking through the request…'
  if (hasStreamingText(latestAssistantMessage)) return 'Writing answer…'

  const toolName = getLatestStreamingToolName(latestAssistantMessage)
  return (toolName && toolProgressLabels[toolName]) || 'Thinking through the request…'
}

function getLatestAssistantMessage(messages: FlueConversationMessage[]) {
  return messages.filter((message) => message.role === 'assistant').at(-1)
}

function hasStreamingText(message: FlueConversationMessage) {
  return message.parts.some((part) => part.type === 'text' && part.state === 'streaming')
}

function getLatestStreamingToolName(message: FlueConversationMessage) {
  return message.parts
    .filter(isActiveToolPart)
    .map((part) => part.toolName)
    .at(-1)
}

function isActiveToolPart(part: FlueConversationPart): part is Extract<FlueConversationPart, {type: 'dynamic-tool'}> {
  return part.type === 'dynamic-tool' && part.state === 'input-available'
}
