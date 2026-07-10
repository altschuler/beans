import {useEffect, useMemo, useRef, useState, type UIEvent} from 'react'

export type CategorizationWorkflowRun = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error: string | null
}

export type CategorizationWorkflowTraceProps = {
  run?: CategorizationWorkflowRun
}

type TraceEvent = Record<string, unknown>
type TraceItem = {key: string; label: string}

const followBottomThresholdPx = 16
const traceReconnectInitialDelayMs = 250
const traceReconnectMaxDelayMs = 5_000
const phaseByToolName: Record<string, string> = {
  searchBankTransactions: 'Finding transactions…',
  getBankTransactionDetail: 'Finding transactions…',
  searchLedgerAccounts: 'Checking available categories…',
  searchLedgerTransactions: 'Reviewing prior categorizations…',
  applyCategorizationSuggestion: 'Applying categorization suggestions…',
}

export function CategorizationWorkflowTrace({run}: CategorizationWorkflowTraceProps) {
  return run ? <CategorizationWorkflowTraceContent key={`${run.id}:${run.status}`} run={run} /> : null
}

function CategorizationWorkflowTraceContent({run}: {run: CategorizationWorkflowRun}) {
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [streamError, setStreamError] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const items = useMemo(() => traceItems(events), [events])
  const itemKey = items.map(item => item.key).join('|')

  useEffect(() => {
    if (run.status !== 'running') return

    const controller = new AbortController()
    void (async () => {
      let startIndex = 0
      let reconnectAttempt = 0
      while (!controller.signal.aborted) {
        try {
          const result = await consumeTrace(run.id, startIndex, controller.signal, event => {
            startIndex += 1
            setEvents(current => [...current, event])
          })
          setStreamError(false)
          if (result.terminal) return
          reconnectAttempt += 1
        } catch (error) {
          if (controller.signal.aborted) return
          console.error('Could not read Eve categorization trace', error)
          setStreamError(true)
          reconnectAttempt += 1
        }
        const delayMs = Math.min(
          traceReconnectInitialDelayMs * 2 ** Math.max(0, reconnectAttempt - 1),
          traceReconnectMaxDelayMs,
        )
        await abortableDelay(delayMs, controller.signal)
      }
    })()
    return () => controller.abort()
  }, [run.id, run.status])

  useEffect(() => {
    if (!shouldFollowRef.current) return
    const container = scrollContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [itemKey])

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    shouldFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= followBottomThresholdPx
  }

  const detail = run.status === 'pending'
    ? 'Preparing AI categorization trace…'
    : run.status === 'failed'
      ? run.error ?? 'AI categorization failed.'
      : streamError
        ? 'Could not connect to AI categorization trace.'
        : items.length === 0
          ? 'Waiting for AI categorization activity…'
          : null

  return (
    <section className="border-b bg-muted/20 px-4 py-3" aria-label="AI workflow trace">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">AI workflow trace</h2>
          <p className="text-xs text-muted-foreground">Team-level trace for the active categorization workflow.</p>
        </div>
        <div className="rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
          {run.status}
        </div>
      </div>

      <div ref={scrollContainerRef} className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1 text-sm" onScroll={handleScroll}>
        {items.length > 0 ? (
          <ol className="space-y-1">
            {items.map(item => (
              <li key={item.key} className="flex items-start gap-2 text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                <span className="font-medium text-foreground">{item.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
      </div>
    </section>
  )
}

async function consumeTrace(
  appRunId: string,
  startIndex: number,
  signal: AbortSignal,
  onEvent: (event: TraceEvent) => void,
) {
  const response = await fetch(
    `/api/eve/categorization/${encodeURIComponent(appRunId)}/trace?startIndex=${startIndex}`,
    {signal},
  )
  if (!response.ok || !response.body) throw new Error(`Trace returned HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false

  const receive = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as TraceEvent
    onEvent(event)
    terminal ||= event.type === 'session.completed' || event.type === 'session.failed'
  }

  while (true) {
    const {done, value} = await reader.read()
    if (done) break
    buffer += decoder.decode(value, {stream: true})
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      receive(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
  receive(buffer)
  return {terminal}
}

function abortableDelay(delayMs: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve()
    const timeout = window.setTimeout(done, delayMs)
    signal.addEventListener('abort', done, {once: true})

    function done() {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

function traceItems(events: TraceEvent[]) {
  const items: TraceItem[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type !== 'actions.requested') continue
    const data = record(event.data)
    if (!Array.isArray(data?.actions)) continue
    for (const value of data.actions) {
      const action = record(value)
      if (action?.kind !== 'tool-call' || typeof action.callId !== 'string' || typeof action.toolName !== 'string') continue
      const label = phaseByToolName[action.toolName]
      if (!label || seen.has(action.callId)) continue
      seen.add(action.callId)
      items.push({key: action.callId, label})
    }
  }
  return items
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
