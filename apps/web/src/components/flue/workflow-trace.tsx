import {useEffect, useMemo, useRef, type UIEvent} from 'react'
import {useFlueWorkflow, type FlueEvent} from '@flue/react'
import {WorkflowFlueProvider} from './workflow-flue-provider'

export type WorkflowTraceProps = {
  flueRunId?: string | null
  title?: string
  description?: string
  pendingMessage?: string
  ariaLabel?: string
}

type TraceItem = {
  key: string
  label: string
  detail: string
}

const followBottomThresholdPx = 16
const workflowProgressEventName = 'penge.workflow.progress'
const workflowProgressMessages = new Set([
  'Finding transactions that need review…',
  'Checking available categories…',
  'Reviewing prior categorizations…',
  'Applying categorization suggestions…',
  'Finishing workflow…',
])

export function WorkflowTrace(props: WorkflowTraceProps) {
  return <WorkflowFlueProvider><WorkflowTraceContent {...props} /></WorkflowFlueProvider>
}

function WorkflowTraceContent({
  flueRunId,
  title = 'Workflow trace',
  description = 'Live trace for the active workflow.',
  pendingMessage = 'Preparing workflow trace…',
  ariaLabel = 'Workflow trace',
}: WorkflowTraceProps) {
  const workflow = useFlueWorkflow({runId: flueRunId ?? undefined})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const visibleItems = useMemo(() => buildUsefulTraceItems(workflow.events), [workflow.events])
  const visibleItemsKey = visibleItems.map(item => `${item.key}:${item.detail}`).join('\n')

  useEffect(() => {
    shouldFollowRef.current = true
  }, [flueRunId])

  useEffect(() => {
    if (!shouldFollowRef.current) return

    const container = scrollContainerRef.current
    if (!container) return

    container.scrollTop = container.scrollHeight
  }, [visibleItemsKey])

  if (flueRunId === undefined) return null

  const statusDetail = getStatusDetail(workflow.status, workflow.error)

  function handleTraceScroll(event: UIEvent<HTMLDivElement>) {
    shouldFollowRef.current = isNearScrollBottom(event.currentTarget)
  }

  return (
    <section className="border-b bg-muted/20 px-4 py-3" aria-label={ariaLabel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
          {flueRunId === null ? 'preparing' : workflow.status}
        </div>
      </div>

      <div ref={scrollContainerRef} className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1 text-sm" onScroll={handleTraceScroll}>
        {flueRunId === null ? (
          <p className="text-muted-foreground">{pendingMessage}</p>
        ) : visibleItems.length === 0 ? (
          <p className="text-muted-foreground">{statusDetail}</p>
        ) : (
          <ol className="space-y-1">
            {visibleItems.map(item => (
              <li key={item.key} className="flex items-start gap-2 text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="font-medium text-foreground">{item.label}: </span>
                  <span className="whitespace-pre-wrap break-words">{item.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {flueRunId !== null && statusDetail ? <p className="text-xs text-muted-foreground">{statusDetail}</p> : null}
      </div>
    </section>
  )
}

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= followBottomThresholdPx
}

function buildUsefulTraceItems(events: FlueEvent[]) {
  const items: TraceItem[] = []
  const indexes = new Map<string, number>()

  function upsert(key: string, detail: string) {
    const index = indexes.get(key)
    if (index === undefined) {
      indexes.set(key, items.length)
      items.push({key, label: 'Progress', detail})
      return
    }

    const current = items[index]
    if (!current) return
    items[index] = {...current, detail}
  }

  for (const event of events) {
    const progressEvent = readWorkflowProgressEvent(event)
    if (!progressEvent) continue
    upsert(progressEventKey(progressEvent), progressEvent.data.message)
  }

  return items
}

type WorkflowProgressEvent = {
  type: 'data'
  name: typeof workflowProgressEventName
  id?: string
  eventIndex: number
  data: {message: string}
}

function readWorkflowProgressEvent(event: unknown): WorkflowProgressEvent | null {
  if (typeof event !== 'object' || event === null) return null
  const candidate = event as {type?: unknown; name?: unknown; id?: unknown; eventIndex?: unknown; data?: unknown}
  if (candidate.type !== 'data' || candidate.name !== workflowProgressEventName) return null
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return null
  if (typeof candidate.eventIndex !== 'number') return null
  if (typeof candidate.data !== 'object' || candidate.data === null) return null
  const message = (candidate.data as {message?: unknown}).message
  if (typeof message !== 'string' || !workflowProgressMessages.has(message)) return null
  return {
    type: 'data',
    name: workflowProgressEventName,
    id: candidate.id,
    eventIndex: candidate.eventIndex,
    data: {message},
  }
}

function progressEventKey(event: WorkflowProgressEvent) {
  return `${event.name}:${event.id ?? event.eventIndex}`
}

function getStatusDetail(status: ReturnType<typeof useFlueWorkflow>['status'], _error: unknown) {
  if (status === 'connecting') return 'Connecting to workflow trace…'
  if (status === 'disconnected') return 'Could not connect to workflow trace.'
  if (status === 'errored') return 'Workflow failed.'
  return null
}
