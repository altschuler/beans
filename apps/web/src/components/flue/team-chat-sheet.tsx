import {useId, useMemo, useState, type FormEvent, type ReactNode} from 'react'
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
}

type TextPart = {type: 'text'; text: string; state?: string}

type ChatMessage = {
  id: string
  role: string
  parts?: Array<TextPart | {type: string; [key: string]: unknown}>
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

export function TeamChatPanel({teamId, userId, isOpen, onClose}: TeamChatPanelProps) {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [chatId, setChatId] = useState(createChatId)
  const titleId = useId()
  const conversationId = useMemo(() => (teamId && userId ? encodeTeamDataAssistantId({teamId, userId, chatId}) : undefined), [chatId, teamId, userId])
  const agent = useFlueAgent({name: 'team-data-assistant', id: conversationId, history: 20, live: 'sse'})
  const canSend = Boolean(conversationId && input.trim() && !isSubmitting)
  const messages = agent.messages as ChatMessage[]
  const activity = getChatActivity({status: agent.status, error: agent.error, isSubmitting, messages})

  function clearChat() {
    setInput('')
    setIsSubmitting(false)
    setChatId(createChatId())
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
      className="flex h-full min-h-0 w-full flex-col border-t bg-background lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l"
    >
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h2 id={titleId} className="font-semibold text-foreground">Ask Penge</h2>
            <p className="text-sm text-muted-foreground">Personal chat for this team. Confirm categorization changes in chat before they are applied.</p>
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
        <form className="space-y-2" onSubmit={submit}>
          <label className="sr-only" htmlFor="team-chat-message">Message Ask Penge</label>
          <Textarea
            id="team-chat-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about transactions or categories…"
            className="min-h-20 resize-none"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canSend} aria-label="Send message">
              <Send className="h-4 w-4" aria-hidden="true" />
              Send
            </Button>
          </div>
        </form>
      </div>
    </aside>
  )
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

function getChatActivity({status, error, isSubmitting, messages}: {status?: string; error?: unknown; isSubmitting: boolean; messages: ChatMessage[]}): ChatActivity | null {
  if (error instanceof Error) return {text: error.message, tone: 'error'}
  if (isSubmitting) return {text: 'Sending…', tone: 'muted'}
  if (status === 'connecting') return {text: 'Connecting to Penge…', tone: 'muted'}
  if (status === 'submitted') return {text: 'Penge is thinking…', tone: 'muted'}
  if (status === 'streaming') return {text: hasStreamingText(messages) ? 'Penge is responding…' : 'Penge is working…', tone: 'muted'}
  if (status && status !== 'idle') return {text: status, tone: 'muted'}
  return null
}

function hasStreamingText(messages: ChatMessage[]) {
  return messages.some((message) => message.role === 'assistant' && (message.parts ?? []).some((part) => part.type === 'text' && part.state === 'streaming'))
}
