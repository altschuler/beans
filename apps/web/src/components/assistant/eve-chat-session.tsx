import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent} from 'react'
import {ArrowUp, Square} from 'lucide-react'
import ReactMarkdown, {type Components} from 'react-markdown'
import {useRouterState} from '@tanstack/react-router'
import {useQuery} from '@rocicorp/zero/react'
import {type ClientSession, type EveMessage, type HandleMessageStreamEvent, type SessionState} from 'eve/client'
import {useEveAgent} from 'eve/react'
import {safeChatProposalSchema} from '@penge/domain/eve-chat-approval'
import {teamChatSitemap} from '@penge/domain/team-chat-ui-context'
import {Bubble, BubbleContent} from '@/components/ui/bubble'
import {Button} from '@/components/ui/button'
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
import {bootstrapEveChat} from '@/eve/chat-bootstrap'
import {
  CHAT_BOOTSTRAP_POLL_INITIAL_MS,
  CHAT_BOOTSTRAP_POLL_MAX_ELAPSED_MS,
  CHAT_BOOTSTRAP_POLL_MAX_MS,
} from '@/eve/chat-runtime-constants'
import {cn} from '@/lib/utils'
import {queries} from '@/zero/queries'
import {ChatApprovalCard, type ChatApprovalAction} from './chat-approval-card'
import {
  areChatEventsCaughtUp,
  createEveChatClientSession,
  projectEveChatEvents,
  toOrderedUniqueChatEvents,
  type ChatEventRow,
} from './eve-chat-event-adapter'
import {EveChatStreamController} from './eve-chat-stream-controller'
import {getTeamChatClientContextForPathname} from './team-chat-page-context'

type ChatApprovalRow = {
  id: string
  sessionOrdinal: number
  requestId: string
  callId: string
  toolName: string
  safeProposal: unknown
  projectionStatus: string
  resolutionStatus: 'pending' | 'approved' | 'denied' | 'completed' | 'expired'
}

type ChatBootstrap = Awaited<ReturnType<typeof bootstrapEveChat>>
type LocalChatState = ChatBootstrap & {session: SessionState | null}
type InFlightTurn = {generation: number; controller: AbortController; promise: Promise<void>}

type EveChatSessionProps = {
  chatId: string
  onFirstSubmit(): void
}

const chatRecoveryExhaustedMessage = 'Ask Penge could not reconnect. Try again.'

const safeChatErrors = new Set([
  'Ask Penge is temporarily unavailable.',
  'Ask Penge could not complete this response.',
  'This chat session could not be resumed.',
  'The response stream was interrupted. Reconnecting may recover it.',
  'This change cannot be safely approved. You can still deny it.',
])

export function EveChatSession({chatId, onFirstSubmit}: EveChatSessionProps) {
  const [eventRows, eventStatus] = useQuery(queries.domain.teamDataAssistantChatEventsByChat({chatId}))
  const [approvalRows] = useQuery(queries.domain.teamDataAssistantChatApprovalsByChat({chatId}))
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [bootstrapRevision, setBootstrapRevision] = useState(0)
  const [retryNonce, setRetryNonce] = useState(0)
  const [retryExhausted, setRetryExhausted] = useState(false)
  const [draft, setDraft] = useState('')
  const bootstrapPromiseRef = useRef<Promise<ChatBootstrap | null> | null>(null)
  const retryStartedAtRef = useRef(0)
  const retryAttemptRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryModeRef = useRef<'admitting' | 'failure' | null>(null)
  const mappingIdentityRef = useRef<string | null>(null)

  const loadBootstrap = useCallback(() => {
    if (bootstrapPromiseRef.current) return bootstrapPromiseRef.current
    const promise = (async () => {
      try {
        const next = await bootstrapEveChat({data: {chatId}})
        const sessionId = next.session && 'sessionId' in next.session ? next.session.sessionId : 'fresh'
        const mappingIdentity = `${next.sessionOrdinal}:${sessionId}`
        if (mappingIdentityRef.current !== null && mappingIdentityRef.current !== mappingIdentity) {
          retryStartedAtRef.current = 0
          retryAttemptRef.current = 0
        }
        mappingIdentityRef.current = mappingIdentity
        if (next.sessionState === 'waiting' || next.sessionState === 'completed' || next.sessionState === 'failed' || next.sessionState === 'none') {
          retryStartedAtRef.current = 0
          retryAttemptRef.current = 0
        }
        setBootstrap(next)
        setBootstrapError(null)
        setRetryExhausted(false)
        setBootstrapRevision(revision => revision + 1)
        return next
      } catch {
        setBootstrapError('Ask Penge is temporarily unavailable.')
        setRetryExhausted(false)
        setRetryNonce(nonce => nonce + 1)
        return null
      } finally {
        bootstrapPromiseRef.current = null
      }
    })()
    bootstrapPromiseRef.current = promise
    return promise
  }, [chatId])

  useEffect(() => {
    void loadBootstrap().catch(() => undefined)
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [chatId, loadBootstrap])

  const retryMode = bootstrapError
    ? 'failure'
    : bootstrap?.sessionState === 'admitting' || bootstrap?.sessionState === 'reconnecting'
      ? 'admitting'
      : null
  useEffect(() => {
    if (!retryMode) {
      retryModeRef.current = null
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
      return
    }
    if (retryModeRef.current !== retryMode) retryModeRef.current = retryMode
    if (retryStartedAtRef.current === 0) {
      retryStartedAtRef.current = Date.now()
      retryAttemptRef.current = 0
    }
    if (retryExhausted || !canUseNetwork() || retryTimerRef.current || bootstrapPromiseRef.current) return
    if (Date.now() - retryStartedAtRef.current >= CHAT_BOOTSTRAP_POLL_MAX_ELAPSED_MS) {
      queueMicrotask(() => setRetryExhausted(true))
      return
    }
    const baseDelay = Math.min(CHAT_BOOTSTRAP_POLL_MAX_MS, CHAT_BOOTSTRAP_POLL_INITIAL_MS * (2 ** retryAttemptRef.current))
    retryAttemptRef.current += 1
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      void loadBootstrap().catch(() => undefined)
    }, Math.round(baseDelay * (0.8 + Math.random() * 0.4)))
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [bootstrapRevision, loadBootstrap, retryExhausted, retryMode, retryNonce])

  useEffect(() => {
    function recover() {
      const mountedStoreOwnsRecovery = bootstrap &&
        bootstrap.sessionState !== 'admitting' && bootstrap.sessionState !== 'reconnecting' && !bootstrapError
      if (mountedStoreOwnsRecovery || !canUseNetwork()) return
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
      if (retryStartedAtRef.current === 0) {
        retryStartedAtRef.current = Date.now()
        retryAttemptRef.current = 0
      }
      void loadBootstrap().catch(() => undefined)
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') recover()
    }
    window.addEventListener('online', recover)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('online', recover)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [bootstrap, bootstrapError, loadBootstrap])

  const beginRecoveryEpoch = useCallback(() => {
    if (retryStartedAtRef.current === 0) {
      retryStartedAtRef.current = Date.now()
      retryAttemptRef.current = 0
    }
  }, [])
  const recoveryCanRetry = useCallback(() => {
    beginRecoveryEpoch()
    return Date.now() - retryStartedAtRef.current < CHAT_BOOTSTRAP_POLL_MAX_ELAPSED_MS
  }, [beginRecoveryEpoch])
  const markRecoveryExhausted = useCallback(() => setRetryExhausted(true), [])
  const retryRecovery = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retryTimerRef.current = null
    retryStartedAtRef.current = Date.now()
    retryAttemptRef.current = 0
    void loadBootstrap().catch(() => undefined)
  }, [loadBootstrap])

  const orderedRows = useMemo(() => toOrderedUniqueChatEvents(eventRows), [eventRows])
  const caughtUp = bootstrap !== null && areChatEventsCaughtUp(
    orderedRows,
    bootstrap.requiredEventCursor,
    eventStatus.type === 'complete',
  )

  if (!bootstrap || !caughtUp || bootstrap.sessionState === 'admitting' || bootstrap.sessionState === 'reconnecting') {
    return <ChatSessionLoading error={bootstrapError} exhausted={retryExhausted} onRetry={retryRecovery} />
  }

  return (
    <EveChatSessionStore
      key={`${chatId}:${bootstrap.sessionOrdinal}:${bootstrap.requiredEventCursor.sessionOrdinal}:${bootstrap.requiredEventCursor.streamIndex}`}
      chatId={chatId}
      bootstrap={bootstrap}
      eventRows={orderedRows}
      approvalRows={approvalRows as ChatApprovalRow[]}
      draft={draft}
      onDraftChange={setDraft}
      hydrationRevision={bootstrapRevision}
      recoveryExhausted={retryExhausted}
      onRetry={retryRecovery}
      onBeginRecovery={beginRecoveryEpoch}
      recoveryCanRetry={recoveryCanRetry}
      onRecoveryExhausted={markRecoveryExhausted}
      onFirstSubmit={onFirstSubmit}
      onRecover={loadBootstrap}
    />
  )
}

function EveChatSessionStore({
  chatId,
  bootstrap,
  eventRows,
  approvalRows,
  draft,
  onDraftChange,
  hydrationRevision,
  recoveryExhausted,
  onRetry,
  onBeginRecovery,
  recoveryCanRetry,
  onRecoveryExhausted,
  onFirstSubmit,
  onRecover,
}: {
  chatId: string
  bootstrap: ChatBootstrap
  eventRows: ChatEventRow[]
  approvalRows: ChatApprovalRow[]
  draft: string
  onDraftChange(value: string): void
  hydrationRevision: number
  recoveryExhausted: boolean
  onRetry(): void
  onBeginRecovery(): void
  recoveryCanRetry(): boolean
  onRecoveryExhausted(): void
  onFirstSubmit(): void
  onRecover(): Promise<ChatBootstrap | null>
}) {
  const pathname = useRouterState({select: state => state.location.pathname})
  const initialEvents = useMemo(() => eventRows.map(row => row.event as HandleMessageStreamEvent), [eventRows])
  const [localState, setLocalState] = useState<LocalChatState>(() => ({...bootstrap, session: bootstrap.session}))
  const [liveRows, setLiveRows] = useState<ChatEventRow[]>([])
  const [pending, setPending] = useState<'sending' | 'stopping' | 'recovering' | null>(null)
  const [submittingApproval, setSubmittingApproval] = useState<{id: string; decision: 'approve' | 'deny'} | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamController = useMemo(() => new EveChatStreamController(), [])
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recoveryAttemptRef = useRef(0)
  const unmountedRef = useRef(false)
  const turnGenerationRef = useRef(0)
  const inFlightTurnRef = useRef<InFlightTurn | null>(null)
  const session = useMemo(() => createEveChatClientSession(chatId, localState.session ?? {streamIndex: 0}), [chatId, localState.session])
  const agent = useEveAgent({
    session,
    initialEvents,
    optimistic: false,
    prepareSend: turn => ({...turn, clientContext: getTeamChatClientContextForPathname(pathname)}),
  })
  const allRows = useMemo(() => toOrderedUniqueChatEvents([...eventRows, ...liveRows]), [eventRows, liveRows])
  const allEvents = useMemo(
    () => allRows.map(row => row.event as HandleMessageStreamEvent),
    [allRows],
  )
  const data = liveRows.length === 0 ? agent.data : projectEveChatEvents(allEvents)
  const persistedError = [...allRows].reverse().find(row =>
    row.sessionOrdinal === localState.sessionOrdinal &&
    (row.event as HandleMessageStreamEvent).type === 'session.failed',
  )?.event as HandleMessageStreamEvent | undefined
  const persistedErrorMessage = persistedError?.type === 'session.failed' && safeChatErrors.has(persistedError.data.message)
    ? persistedError.data.message
    : null
  const appBusy = localState.sessionState === 'admitting' || localState.sessionState === 'running'
  const locallyBusy = pending !== null || submittingApproval !== null || agent.status === 'submitted' || agent.status === 'streaming'
  const busy = appBusy || locallyBusy || recoveryExhausted
  const canSend = Boolean(draft.trim() && !busy && (localState.sessionState === 'none' || localState.sessionState === 'waiting' || localState.sessionState === 'completed' || localState.sessionState === 'failed'))

  const recover = useCallback(async () => {
    if (!canUseNetwork() || unmountedRef.current) return
    setPending('recovering')
    const next = await onRecover()
    if (unmountedRef.current) return
    setPending(null)
    if (!next) return
  }, [onRecover])

  const scheduleRecovery = useCallback(() => {
    onBeginRecovery()
    if (!recoveryCanRetry()) {
      onRecoveryExhausted()
      return
    }
    if (!canUseNetwork() || unmountedRef.current || recoveryTimerRef.current) return
    const delay = Math.min(CHAT_BOOTSTRAP_POLL_MAX_MS, CHAT_BOOTSTRAP_POLL_INITIAL_MS * (2 ** recoveryAttemptRef.current))
    recoveryAttemptRef.current = Math.min(recoveryAttemptRef.current + 1, 4)
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null
      void recover().catch(() => undefined)
    }, Math.round(delay * (0.8 + Math.random() * 0.4)))
  }, [onBeginRecovery, onRecoveryExhausted, recover, recoveryCanRetry])

  const attach = useCallback((attachSession: ClientSession, sessionOrdinal: number, startIndex: number) => {
    setPending('recovering')
    return streamController.attach({
      session: attachSession,
      startIndex,
      onEvent: (event, streamIndex) => {
        if (!unmountedRef.current) setLiveRows(rows => toOrderedUniqueChatEvents([...rows, {sessionOrdinal, streamIndex, event}]))
      },
      onStop: outcome => {
        if (unmountedRef.current) return
        setPending(null)
        if (outcome.kind === 'boundary') {
          recoveryAttemptRef.current = 0
          onBeginRecovery()
          void recover().catch(() => undefined)
        } else if (outcome.kind === 'error') {
          setError(toSafeChatError(outcome.error, 'The response stream was interrupted. Reconnecting may recover it.'))
          scheduleRecovery()
        } else if (outcome.kind === 'eof') {
          scheduleRecovery()
        }
      },
    })
  }, [onBeginRecovery, recover, scheduleRecovery, streamController])

  const abortInFlightTurn = useCallback(() => {
    const turn = inFlightTurnRef.current
    if (!turn) return Promise.resolve()
    turnGenerationRef.current += 1
    turn.controller.abort()
    return turn.promise.catch(() => undefined)
  }, [])

  useEffect(() => {
    if (recoveryExhausted) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setLocalState({...bootstrap, session: bootstrap.session})
    })
    return () => { cancelled = true }
  }, [bootstrap, hydrationRevision, recoveryExhausted])

  useEffect(() => {
    if (localState.sessionState !== 'running' || !localState.session?.sessionId || recoveryExhausted) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void attach(session, localState.sessionOrdinal, localState.session?.streamIndex ?? 0).catch(() => undefined)
    })
    return () => { cancelled = true }
  }, [attach, localState, recoveryExhausted, session])

  useEffect(() => {
    resizeComposer(inputRef.current)
  }, [draft])

  const stopAgent = agent.stop
  useEffect(() => {
    unmountedRef.current = false
    function recoverAfterLocalSettlement() {
      onBeginRecovery()
      const streamStopped = streamController.stop()
      const turnStopped = abortInFlightTurn()
      void Promise.allSettled([streamStopped, turnStopped]).then(() => recover()).catch(() => undefined)
    }
    function onOnline() {
      if (document.visibilityState !== 'hidden') recoverAfterLocalSettlement()
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        const streamStopped = streamController.stop()
        const turnStopped = abortInFlightTurn()
        void Promise.allSettled([streamStopped, turnStopped]).catch(() => undefined)
      } else if (navigator.onLine !== false) {
        recoverAfterLocalSettlement()
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unmountedRef.current = true
      const streamStopped = streamController.stop()
      const turnStopped = abortInFlightTurn()
      void Promise.allSettled([streamStopped, turnStopped]).catch(() => undefined)
      stopAgent()
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [abortInFlightTurn, onBeginRecovery, recover, stopAgent, streamController])

  function startTurn(
    payload: {message?: string; inputResponses?: Array<{requestId: string; optionId: 'approve' | 'deny'}>},
    approvalSubmission?: {id: string; decision: 'approve' | 'deny'},
    onAdmitted?: () => void,
  ) {
    const stateAllowsTurn = localState.sessionState === 'none' || localState.sessionState === 'waiting' || localState.sessionState === 'completed' || localState.sessionState === 'failed'
    if (inFlightTurnRef.current || busy || !stateAllowsTurn) return false
    if (!canUseNetwork()) {
      setError('Ask Penge is temporarily unavailable.')
      return false
    }

    const generation = turnGenerationRef.current + 1
    turnGenerationRef.current = generation
    const controller = new AbortController()
    setError(null)
    setPending('sending')
    if (approvalSubmission) setSubmittingApproval(approvalSubmission)

    const isCurrent = () => !controller.signal.aborted && !unmountedRef.current && turnGenerationRef.current === generation
    const promise = (async () => {
      try {
        const sendingSession = createEveChatClientSession(chatId, localState.session ?? {streamIndex: 0})
        const response = await sendingSession.send({
          ...payload,
          clientContext: getTeamChatClientContextForPathname(pathname),
          signal: controller.signal,
        })
        if (!isCurrent()) return
        const isStart = !localState.session?.sessionId
        const nextOrdinal = isStart ? localState.sessionOrdinal + 1 : localState.sessionOrdinal
        const continuationToken = response.continuationToken ?? localState.session?.continuationToken
        if (!continuationToken) throw new Error('This chat session could not be resumed.')
        const nextSession = {
          sessionId: response.sessionId,
          continuationToken,
          streamIndex: isStart ? 0 : localState.session?.streamIndex ?? 0,
        }
        if (!isCurrent()) return
        onAdmitted?.()
        recoveryAttemptRef.current = 0
        setLocalState(state => ({
          ...state,
          session: nextSession,
          sessionOrdinal: nextOrdinal,
          sessionState: 'running',
          requiredEventCursor: {sessionOrdinal: nextOrdinal, streamIndex: nextSession.streamIndex},
        }))
        setPending('recovering')
        if (!isCurrent()) return
        await attach(createEveChatClientSession(chatId, nextSession), nextOrdinal, nextSession.streamIndex)
      } catch (cause) {
        if (!isCurrent()) return
        setError(toSafeChatError(cause))
        setPending(null)
        scheduleRecovery()
      } finally {
        const active = inFlightTurnRef.current
        if (active?.generation === generation) inFlightTurnRef.current = null
        if (approvalSubmission && !unmountedRef.current && turnGenerationRef.current === generation) setSubmittingApproval(null)
      }
    })()
    const turn = {generation, controller, promise}
    inFlightTurnRef.current = turn
    void promise.catch(() => undefined)
    return true
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !canSend) return
    startTurn({message}, undefined, () => {
      onDraftChange('')
      onFirstSubmit()
    })
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  function stop() {
    if (!busy || pending === 'stopping') return
    setPending('stopping')
    agent.stop()
    onBeginRecovery()
    const streamStopped = streamController.stop()
    const turnStopped = abortInFlightTurn()
    void Promise.allSettled([streamStopped, turnStopped]).then(() => recover()).catch(() => undefined)
  }

  function respondToApproval(action: ChatApprovalAction) {
    const current = approvalRows.find(row => row.id === action.approvalId)
    const parsedProposal = safeChatProposalSchema.safeParse(current?.safeProposal)
    const exact = current &&
      current.resolutionStatus === 'pending' &&
      current.sessionOrdinal === localState.sessionOrdinal &&
      current.sessionOrdinal === action.sessionOrdinal &&
      current.requestId === action.requestId &&
      current.callId === action.toolCallId &&
      JSON.stringify(parsedProposal.success ? parsedProposal.data : null) === JSON.stringify(action.proposal)
    if (!exact || localState.sessionState !== 'waiting' || submittingApproval) return
    if (action.decision === 'approve' && (current.projectionStatus !== 'ready' || !parsedProposal.success)) return
    startTurn(
      {inputResponses: [{requestId: current.requestId, optionId: action.decision}]},
      {id: current.id, decision: action.decision},
    )
  }

  const visibleApprovals = approvalRows.filter(row =>
    row.sessionOrdinal === localState.sessionOrdinal &&
    (row.resolutionStatus === 'pending' || row.resolutionStatus === 'expired'),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="p-4">
            <MessageScrollerContent className="gap-6" aria-label="Ask Penge chat transcript">
              <EveChatTranscript messages={data.messages} />
              {visibleApprovals.map(row => {
                const parsed = safeChatProposalSchema.safeParse(row.safeProposal)
                return (
                  <MessageScrollerItem key={row.id} messageId={`approval:${row.id}`}>
                    <ChatApprovalCard
                      approvalId={row.id}
                      requestId={row.requestId}
                      toolCallId={row.callId}
                      proposal={parsed.success ? parsed.data : null}
                      toolName={row.toolName}
                      projectionStatus={row.projectionStatus}
                      resolutionStatus={row.resolutionStatus === 'expired' ? 'expired' : 'pending'}
                      sessionOrdinal={row.sessionOrdinal}
                      currentSessionOrdinal={localState.sessionOrdinal}
                      sessionState={localState.sessionState}
                      isSubmitting={submittingApproval?.id === row.id}
                      submittingDecision={submittingApproval?.id === row.id ? submittingApproval.decision : undefined}
                      onRespond={respondToApproval}
                    />
                  </MessageScrollerItem>
                )
              })}
              {pending && !recoveryExhausted ? <MessageScrollerItem messageId="activity"><ChatActivity text={pending === 'sending' ? 'Sending…' : pending === 'stopping' ? 'Stopping…' : 'Reconnecting…'} /></MessageScrollerItem> : null}
              {recoveryExhausted ? <MessageScrollerItem messageId="recovery-exhausted"><RecoveryExhausted onRetry={onRetry} /></MessageScrollerItem> : null}
              {error ?? persistedErrorMessage ? <MessageScrollerItem messageId="error"><ChatActivity text={error ?? persistedErrorMessage ?? ''} error /></MessageScrollerItem> : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="border-t bg-background p-3">
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor={`team-chat-message-${chatId}`}>Message Ask Penge</label>
          <InputGroup>
            <InputGroupTextarea
              ref={inputRef}
              id={`team-chat-message-${chatId}`}
              rows={1}
              value={draft}
              disabled={busy}
              onChange={event => onDraftChange(event.currentTarget.value)}
              onKeyDown={submitOnEnter}
              placeholder="Ask about transactions, categories, or what needs review…"
              className="max-h-40 min-h-16 overflow-y-auto"
            />
            <InputGroupAddon align="block-end">
              <InputGroupButton
                type={busy ? 'button' : 'submit'}
                variant={busy ? 'outline' : 'default'}
                size="icon-sm"
                disabled={recoveryExhausted || (busy ? pending === 'stopping' : !canSend)}
                aria-label={busy ? 'Stop response' : 'Send message'}
                className="ml-auto rounded-full"
                onClick={busy ? stop : undefined}
              >
                {busy ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  )
}

export function EveChatTranscript({messages}: {messages: readonly EveMessage[]}) {
  return messages.map(message => {
    const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim()
    const activity = message.parts.filter(part => part.type === 'dynamic-tool' && (part.state === 'input-available' || part.state === 'input-streaming')).at(-1)
    if (!text && !activity) return null
    return (
      <MessageScrollerItem key={message.id} messageId={message.id}>
        {text ? <ChatMessage role={message.role}>{text}</ChatMessage> : null}
        {activity ? <ChatActivity text={toolActivityLabels[activity.toolName] ?? 'Thinking through the request…'} /> : null}
      </MessageScrollerItem>
    )
  })
}

function ChatSessionLoading({error, exhausted, onRetry}: {error: string | null; exhausted: boolean; onRetry(): void}) {
  if (exhausted) return <div className="flex min-h-0 flex-1 items-center justify-center p-4"><RecoveryExhausted onRetry={onRetry} /></div>
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4" role="status">
      <span className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{error ?? 'Loading chat…'}</span>
    </div>
  )
}

function RecoveryExhausted({onRetry}: {onRetry(): void}) {
  return (
    <div className="space-y-2 text-center" role="status">
      <p className="text-sm text-destructive">{chatRecoveryExhaustedMessage}</p>
      <Button type="button" variant="outline" size="sm" aria-label="Retry Ask Penge connection" onClick={onRetry}>Retry</Button>
    </div>
  )
}

function ChatActivity({text, error = false}: {text: string; error?: boolean}) {
  return (
    <Marker role="status">
      {error ? null : <MarkerIcon><Spinner /></MarkerIcon>}
      <MarkerContent className={error ? 'text-destructive' : 'shimmer'}>{text}</MarkerContent>
    </Marker>
  )
}

function ChatMessage({role, children}: {role: EveMessage['role']; children: string}) {
  return (
    <Message align={role === 'user' ? 'end' : 'start'}>
      <MessageContent>
        <Bubble variant={role === 'user' ? 'muted' : 'outline'}>
          <BubbleContent><ChatMarkdown>{children}</ChatMarkdown></BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

const safeStaticChatLinks = new Set(teamChatSitemap.map(entry => entry.href))
const markdownComponents = {
  p({node: _node, className, ...props}) { return <p className={cn('whitespace-pre-wrap leading-relaxed not-first:mt-2', className)} {...props} /> },
  ul({node: _node, className, ...props}) { return <ul className={cn('my-2 list-disc space-y-1 pl-5', className)} {...props} /> },
  ol({node: _node, className, ...props}) { return <ol className={cn('my-2 list-decimal space-y-1 pl-5', className)} {...props} /> },
  li({node: _node, className, ...props}) { return <li className={cn('pl-1', className)} {...props} /> },
  a({node: _node, className, href, children, ...props}) {
    return href && safeStaticChatLinks.has(href)
      ? <a className={cn('underline underline-offset-2 hover:text-primary', className)} href={href} {...props}>{children}</a>
      : <span>{children}</span>
  },
  code({node: _node, className, ...props}) { return <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]', className)} {...props} /> },
  pre({node: _node, className, ...props}) { return <pre className={cn('my-2 overflow-x-auto rounded-md border bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0', className)} {...props} /> },
} satisfies Components

function ChatMarkdown({children}: {children: string}) {
  return <ReactMarkdown allowedElements={['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li']} components={markdownComponents} skipHtml>{children}</ReactMarkdown>
}

const toolActivityLabels: Record<string, string> = {
  searchBankTransactions: 'Searching transactions…',
  getBankTransactionDetail: 'Reading transaction details…',
  searchLedgerAccounts: 'Checking categories…',
  manageCategory: 'Checking categories…',
  applyCategorizations: 'Checking categories…',
  searchLedgerTransactions: 'Reviewing prior categorizations…',
}

function resizeComposer(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = 'auto'
  const style = window.getComputedStyle(element)
  const borders = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0)
  element.style.height = `${element.scrollHeight + borders}px`
}

function canUseNetwork() {
  return (typeof navigator === 'undefined' || navigator.onLine !== false) &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden')
}

function toSafeChatError(error: unknown, fallback = 'Ask Penge could not complete this response.') {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return safeChatErrors.has(message) ? message : fallback
}
