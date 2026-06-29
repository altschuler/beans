import {useEffect, useMemo, useRef, type UIEvent} from 'react'
import {useFlueWorkflow, type FlueEvent} from '@flue/react'

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

const maxJsonPreviewLength = 240
const followBottomThresholdPx = 16

export function WorkflowTrace({
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

  function upsert(key: string, label: string, detail: string, mode: 'replace' | 'append' = 'replace') {
    const index = indexes.get(key)
    if (index === undefined) {
      indexes.set(key, items.length)
      items.push({key, label, detail})
      return
    }

    const current = items[index]
    if (!current) return
    items[index] = {
      ...current,
      label,
      detail: mode === 'append' ? `${current.detail}${detail}` : detail,
    }
  }

  for (const event of events) {
    switch (event.type) {
      case 'thinking_delta':
        upsert(reasoningKey(event), 'Thinking', event.delta, 'append')
        break
      case 'thinking_end':
        upsert(reasoningKey(event), 'Thinking', event.content)
        break
      case 'text_delta':
        upsert(textKey(event), 'Agent', event.text, 'append')
        break
      case 'tool_start':
        upsert(toolKey(event), 'Tool', `Calling ${event.toolName}${event.args === undefined ? '' : ` with ${formatJsonPreview(event.args)}`}`)
        break
      case 'tool':
        upsert(toolKey(event), 'Tool', toolResultDetail(event), 'append')
        break
      case 'log':
        upsert(`log:${event.timestamp}:${event.eventIndex}`, 'Log', event.message)
        break
      default:
        break
    }
  }

  return items.filter(item => item.detail.trim())
}

function reasoningKey(event: Extract<FlueEvent, {type: 'thinking_delta' | 'thinking_end'}>) {
  return `thinking:${event.turnId ?? 'unknown'}:${event.contentIndex ?? 'latest'}`
}

function textKey(event: Extract<FlueEvent, {type: 'text_delta'}>) {
  return `text:${event.turnId ?? 'unknown'}`
}

function toolKey(event: Extract<FlueEvent, {type: 'tool_start' | 'tool'}>) {
  return `tool:${event.toolCallId}`
}

function toolResultDetail(event: Extract<FlueEvent, {type: 'tool'}>) {
  const status = event.isError ? 'Failed' : 'Finished'
  return ` · ${status} in ${event.durationMs} ms`
}

function formatJsonPreview(value: unknown) {
  const json = stringifyPreview(value)
  return json.length > maxJsonPreviewLength ? `${json.slice(0, maxJsonPreviewLength - 1)}…` : json
}

function stringifyPreview(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function getStatusDetail(status: ReturnType<typeof useFlueWorkflow>['status'], error: unknown) {
  if (status === 'connecting') return 'Connecting to workflow trace…'
  if (status === 'disconnected') return 'Could not connect to workflow trace.'
  if (status === 'errored') return errorToText(error) ?? 'Workflow failed.'
  return null
}

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return null
}
