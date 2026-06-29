import {useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode} from 'react'
import {MessageCircle, Send, X} from 'lucide-react'
import ReactMarkdown, {type Components} from 'react-markdown'
import {useFlueAgent} from '@flue/react'
import {encodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {Button} from '@/components/ui/button'
import {Textarea} from '@/components/ui/textarea'
import {cn} from '@/lib/utils'

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

type TextPart = {type: 'text'; text: string; state?: string}
type ChatMessagePart = TextPart | {type: string; state?: string; toolName?: string; tool?: string; name?: string; [key: string]: unknown}

type ChatMessage = {
  id: string
  role: string
  parts?: ChatMessagePart[]
}

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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [chatId, setChatId] = useState(createChatId)
  const titleId = useId()
  const conversationId = useMemo(() => (teamId && userId ? encodeTeamDataAssistantId({teamId, userId, chatId}) : undefined), [chatId, teamId, userId])
  const agent = useFlueAgent({name: 'team-data-assistant', id: conversationId, history: 20, live: 'sse'})
  const canSend = Boolean(conversationId && input.trim() && !isSubmitting)
  const messages = agent.messages as ChatMessage[]
  const activity = useStableChatActivity(getChatActivity({status: agent.status, error: agent.error, isSubmitting, messages}))

  useEffect(() => {
    resizeComposer(inputRef.current)
  }, [input])

  function clearChat() {
    setInput('')
    setIsSubmitting(false)
    setChatId(createChatId())
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
    if (!message || !conversationId || isSubmitting) return

    setInput('')
    setIsSubmitting(true)
    try {
      await agent.sendMessage(message)
    } finally {
      setIsSubmitting(false)
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
            <Button type="button" variant="outline" size="sm" disabled={!conversationId} onClick={clearChat}>
              Clear chat
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Close chat" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/30 p-4" role="log" aria-label="Ask Penge chat transcript" aria-live="polite">
        {agent.messages.length === 0 && !activity ? (
          <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
            Ask about transactions, categories, or what needs review.
          </div>
        ) : null}
        {messages.map((message) => <ChatBubble key={message.id} message={message} />)}
        {activity ? <ChatActivityBubble activity={activity} /> : null}
      </div>

      <div className="border-t bg-background p-3">
        <form className="flex items-end gap-2" onSubmit={submit}>
          <label className="sr-only" htmlFor="team-chat-message">Message Ask Penge</label>
          <Textarea
            ref={inputRef}
            id="team-chat-message"
            rows={1}
            value={input}
            onChange={(event) => updateInput(event.currentTarget)}
            onKeyDown={submitOnEnter}
            placeholder="Ask..."
            className="max-h-32 min-h-9 flex-1 resize-none overflow-y-auto py-2"
          />
          <Button type="submit" size="sm" disabled={!canSend} aria-label="Send message" className="shrink-0">
            <Send className="h-4 w-4" aria-hidden="true" />
            Send
          </Button>
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

function ChatBubble({message}: {message: ChatMessage}) {
  const isUser = message.role === 'user'
  const textParts = (message.parts ?? []).filter((part): part is TextPart => part.type === 'text')
  const text = textParts.map((part) => part.text).join('\n\n').trim()
  if (!text) return null

  return (
    <article className={cn('max-w-[85%] rounded-lg border px-3 py-2 text-sm', isUser ? 'ml-auto bg-primary text-primary-foreground' : 'bg-background')}>
      <div className="mb-1 text-xs font-medium opacity-70">{isUser ? 'You' : 'Penge'}</div>
      <ChatMarkdown>{text}</ChatMarkdown>
    </article>
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

function ChatActivityBubble({activity}: {activity: ChatActivity}) {
  return (
    <article className={cn('max-w-[85%] rounded-lg border bg-background px-3 py-2 text-sm', activity.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
      <div className="mb-1 text-xs font-medium opacity-70">Penge</div>
      {activity.text}
    </article>
  )
}

function useStableChatActivity(activity: ChatActivity | null) {
  const [displayedActivity, setDisplayedActivity] = useState(activity)
  const shownAtRef = useRef(Date.now())
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

    const elapsed = Date.now() - shownAtRef.current
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

function getChatActivity({status, error, isSubmitting, messages}: {status?: string; error?: unknown; isSubmitting: boolean; messages: ChatMessage[]}): ChatActivity | null {
  if (error instanceof Error) return {text: error.message, tone: 'error'}
  if (isSubmitting) return {text: 'Sending…', tone: 'muted'}
  if (status === 'connecting') return {text: 'Connecting to Penge…', tone: 'muted'}
  if (status === 'submitted') return {text: 'Starting…', tone: 'muted'}
  if (status === 'streaming') return {text: getStreamingActivityText(messages), tone: 'muted'}
  if (status && status !== 'idle') return {text: 'Thinking through the request…', tone: 'muted'}
  return null
}

function getStreamingActivityText(messages: ChatMessage[]) {
  const latestAssistantMessage = getLatestAssistantMessage(messages)
  if (!latestAssistantMessage) return 'Thinking through the request…'
  if (hasStreamingText(latestAssistantMessage)) return 'Writing answer…'

  const toolName = getLatestStreamingToolName(latestAssistantMessage)
  return (toolName && toolProgressLabels[toolName]) || 'Thinking through the request…'
}

function getLatestAssistantMessage(messages: ChatMessage[]) {
  return messages.filter((message) => message.role === 'assistant').at(-1)
}

function hasStreamingText(message: ChatMessage) {
  return (message.parts ?? []).some((part) => part.type === 'text' && part.state === 'streaming')
}

function getLatestStreamingToolName(message: ChatMessage) {
  return (message.parts ?? [])
    .filter(isActiveToolPart)
    .map(getToolName)
    .filter((toolName): toolName is string => Boolean(toolName))
    .at(-1)
}

function isActiveToolPart(part: ChatMessagePart) {
  return Boolean(getToolName(part)) && part.state !== 'output-available' && part.state !== 'output-error'
}

function getToolName(part: ChatMessagePart) {
  if ('toolName' in part && typeof part.toolName === 'string') return part.toolName
  if ('tool' in part && typeof part.tool === 'string') return part.tool
  if ('name' in part && typeof part.name === 'string') return part.name
  if (part.type.startsWith('tool-')) return part.type.slice('tool-'.length)
  return null
}
