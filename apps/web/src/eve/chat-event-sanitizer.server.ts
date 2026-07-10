import '@tanstack/react-start/server-only'

import {db} from '@/db/client'
import {getSafeChatError} from './chat-error-catalog'
import {
  resolveChatApprovalProposal,
  type ChatApprovalProposalResult,
} from '@penge/domain/chat-approval-proposals'
import type {SafeChatProposal} from '@penge/domain/eve-chat-approval'
import type {TrustedTeamScope} from '@penge/domain/team-scope'

const safeToolNames = new Set([
  'searchBankTransactions',
  'getBankTransactionDetail',
  'searchLedgerTransactions',
  'searchLedgerAccounts',
  'applyCategorizationSuggestion',
  'applyCategorizations',
  'manageCategory',
  'read_file',
  'write_file',
  'glob',
  'grep',
])
const approvalToolNames = new Set(['applyCategorizations', 'manageCategory'])
const finishReasons = new Set(['content-filter', 'error', 'length', 'other', 'stop', 'tool-calls'])
const actionStatuses = new Set(['completed', 'failed', 'rejected'])

export type ApprovalProjection = {
  requestId: string
  callId: string
  toolName: string
  safeProposal: SafeChatProposal | null
  projectionStatus: 'ready' | 'blocked'
}

declare const sanitizedChatEventBrand: unique symbol

type SanitizedChatEventValue = {
  event: Record<string, unknown>
  approvalProjections: ApprovalProjection[]
}

export type SanitizedChatEvent = SanitizedChatEventValue & {
  readonly [sanitizedChatEventBrand]: true
}

type SanitizeOptions = {
  scope: TrustedTeamScope
  resolveProposal?: (input: {scope: TrustedTeamScope; toolName: string; input: unknown}) => Promise<ChatApprovalProposalResult>
}

export async function sanitizeChatEvent(raw: unknown, options: SanitizeOptions): Promise<SanitizedChatEvent> {
  return sanitizeChatEventValue(raw, options) as Promise<SanitizedChatEvent>
}

/**
 * App-owned positional terminal event used only when Eve confirms that the currently mapped
 * session no longer exists. It preserves the prior transcript and contains no runtime error data.
 */
export function createMissingChatSessionFailureEvent(): SanitizedChatEvent {
  return {
    event: {
      type: 'session.failed',
      data: {
        code: 'CHAT_SESSION_UNAVAILABLE',
        message: getSafeChatError({code: 'CHAT_SESSION_UNAVAILABLE'}).message,
        sessionId: 'redacted-session',
      },
    },
    approvalProjections: [],
  } as unknown as SanitizedChatEvent
}

async function sanitizeChatEventValue(raw: unknown, options: SanitizeOptions): Promise<SanitizedChatEventValue> {
  const source = record(raw)
  const meta = safeMeta(source?.meta)
  const noOp = (): SanitizedChatEventValue => ({event: withMeta({type: 'session.started', data: {}}, meta), approvalProjections: []})
  if (!source || typeof source.type !== 'string') return noOp()
  const data = record(source.data)

  if (source.type === 'session.started') return noOp()
  if (source.type === 'session.completed') {
    return {event: withMeta({type: 'session.completed'}, meta), approvalProjections: []}
  }
  if (source.type === 'session.waiting') {
    return data?.wait === 'next-user-message'
      ? {event: withMeta({type: 'session.waiting', data: {wait: 'next-user-message'}}, meta), approvalProjections: []}
      : noOp()
  }
  if (source.type === 'session.failed') {
    const error = getSafeChatError(data)
    return {
      event: withMeta({type: 'session.failed', data: {...error, sessionId: 'redacted-session'}}, meta),
      approvalProjections: [],
    }
  }
  if (!data) return noOp()

  if (source.type === 'turn.started' || source.type === 'turn.completed') {
    const turn = turnStructure(data)
    return turn ? {event: withMeta({type: source.type, data: turn}, meta), approvalProjections: []} : noOp()
  }
  if (source.type === 'message.received') {
    const turn = turnStructure(data)
    if (!turn || typeof data.message !== 'string') return noOp()
    return {
      event: withMeta({type: source.type, data: {...turn, message: data.message}}, meta),
      approvalProjections: [],
    }
  }
  if (source.type === 'step.started') {
    const step = stepStructure(data)
    return step ? {event: withMeta({type: source.type, data: step}, meta), approvalProjections: []} : noOp()
  }
  if (source.type === 'step.completed') {
    const step = stepStructure(data)
    if (!step || typeof data.finishReason !== 'string' || !finishReasons.has(data.finishReason)) return noOp()
    return {
      event: withMeta({type: source.type, data: {...step, finishReason: data.finishReason}}, meta),
      approvalProjections: [],
    }
  }
  if (source.type === 'message.appended') {
    const step = stepStructure(data)
    if (!step || typeof data.messageDelta !== 'string' || typeof data.messageSoFar !== 'string') return noOp()
    return {
      event: withMeta({type: source.type, data: {...step, messageDelta: data.messageDelta, messageSoFar: data.messageSoFar}}, meta),
      approvalProjections: [],
    }
  }
  if (source.type === 'message.completed') {
    const step = stepStructure(data)
    if (!step || (typeof data.message !== 'string' && data.message !== null) || typeof data.finishReason !== 'string' || !finishReasons.has(data.finishReason)) return noOp()
    return {
      event: withMeta({type: source.type, data: {...step, message: data.message, finishReason: data.finishReason}}, meta),
      approvalProjections: [],
    }
  }
  if (source.type === 'actions.requested') {
    const step = stepStructure(data)
    if (!step || !Array.isArray(data.actions)) return noOp()
    const actions = data.actions.map(sanitizeActionRequest)
    if (actions.some(action => action === null)) return noOp()
    return {
      event: withMeta({type: source.type, data: {...step, actions}}, meta),
      approvalProjections: [],
    }
  }
  if (source.type === 'input.requested') {
    const step = stepStructure(data)
    if (!step || !Array.isArray(data.requests)) return noOp()
    const seenRequestIds = new Set<string>()
    for (const rawRequest of data.requests) {
      const request = record(rawRequest)
      const action = record(request?.action)
      const requestId = safeId(request?.requestId)
      if (!request || !action || requestId === null || seenRequestIds.has(requestId)) return noOp()
      seenRequestIds.add(requestId)
    }
    const resolveProposal = options.resolveProposal ?? (input => resolveChatApprovalProposal(db, input))
    const requests = []
    const approvalProjections: ApprovalProjection[] = []
    for (const rawRequest of data.requests) {
      const request = record(rawRequest)
      const action = record(request?.action)
      const requestId = safeId(request?.requestId)
      const callId = safeId(action?.callId)
      if (!request || !action || requestId === null || callId === null || action.kind !== 'tool-call') return noOp()
      const toolName = safeToolName(action.toolName)
      let resolved: ChatApprovalProposalResult = {status: 'blocked'}
      if (approvalToolNames.has(toolName)) {
        try {
          resolved = await resolveProposal({scope: options.scope, toolName, input: action.input})
        } catch {
          resolved = {status: 'blocked'}
        }
      }
      const safeProposal = resolved.status === 'ready' ? resolved.proposal : null
      const projectionStatus = resolved.status
      requests.push({
        requestId,
        prompt: 'Approve this change?',
        display: 'confirmation',
        allowFreeform: false,
        options: [
          {id: 'approve', label: 'Approve', style: 'primary'},
          {id: 'deny', label: 'Deny', style: 'danger'},
        ],
        action: {kind: 'tool-call', callId, toolName, input: safeProposal ?? {}},
      })
      approvalProjections.push({requestId, callId, toolName, safeProposal, projectionStatus})
    }
    return {
      event: withMeta({type: source.type, data: {...step, requests}}, meta),
      approvalProjections,
    }
  }
  if (source.type === 'action.result') {
    const step = stepStructure(data)
    const result = record(data.result)
    if (!step || !result || typeof data.status !== 'string' || !actionStatuses.has(data.status)) return noOp()
    const sanitizedResult = sanitizeActionResult(result, data.status)
    if (!sanitizedResult) return noOp()
    const error = data.status === 'rejected'
      ? {code: 'TOOL_EXECUTION_DENIED', message: 'This change was denied.'}
      : data.status === 'failed'
        ? getSafeChatError(data.error)
        : undefined
    return {
      event: withMeta({
        type: source.type,
        data: {...step, status: data.status, result: sanitizedResult, ...(error ? {error} : {})},
      }, meta),
      approvalProjections: [],
    }
  }
  if (source.type === 'step.failed') {
    const step = stepStructure(data)
    if (!step) return noOp()
    return {event: withMeta({type: source.type, data: {...step, ...getSafeChatError(data)}}, meta), approvalProjections: []}
  }
  if (source.type === 'turn.failed') {
    const turn = turnStructure(data)
    if (!turn) return noOp()
    return {event: withMeta({type: source.type, data: {...turn, ...getSafeChatError(data)}}, meta), approvalProjections: []}
  }

  // Reasoning, structured output, compaction, subagent, authorization, and future events
  // intentionally reduce to Eve's valid no-op envelope while preserving positional cardinality.
  return noOp()
}

function sanitizeActionRequest(value: unknown) {
  const action = record(value)
  const callId = safeId(action?.callId)
  if (!action || callId === null || typeof action.kind !== 'string') return null
  if (action.kind === 'tool-call') {
    return {kind: 'tool-call', callId, toolName: safeToolName(action.toolName), input: {}}
  }
  if (action.kind === 'load-skill') return {kind: 'load-skill', callId, input: {}}
  if (action.kind === 'subagent-call') {
    return {kind: 'subagent-call', callId, description: '', input: {}, name: 'redacted', nodeId: 'redacted', subagentName: 'redacted'}
  }
  if (action.kind === 'remote-agent-call') {
    return {kind: 'remote-agent-call', callId, description: '', input: {}, name: 'redacted', nodeId: 'redacted', remoteAgentName: 'redacted'}
  }
  return null
}

function sanitizeActionResult(result: Record<string, unknown>, status: unknown) {
  const callId = safeId(result.callId)
  if (callId === null || typeof result.kind !== 'string') return null
  const common = {callId, output: {redacted: true}, ...(status === 'failed' ? {isError: true} : {})}
  if (result.kind === 'tool-result') return {kind: result.kind, ...common, toolName: safeToolName(result.toolName)}
  if (result.kind === 'load-skill-result') return {kind: result.kind, ...common, name: 'redacted'}
  if (result.kind === 'subagent-result') return {kind: result.kind, ...common, subagentName: 'redacted'}
  return null
}

function turnStructure(data: Record<string, unknown>) {
  const sequence = safeInteger(data.sequence)
  const turnId = safeId(data.turnId)
  return sequence === null || turnId === null ? null : {sequence, turnId}
}

function stepStructure(data: Record<string, unknown>) {
  const turn = turnStructure(data)
  const stepIndex = safeInteger(data.stepIndex)
  return !turn || stepIndex === null ? null : {...turn, stepIndex}
}

function safeToolName(value: unknown) {
  return typeof value === 'string' && safeToolNames.has(value) ? value : 'unsupported'
}

function safeId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null
}

function safeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function safeMeta(value: unknown) {
  const meta = record(value)
  if (!meta || typeof meta.at !== 'string' || meta.at.length > 64 || !isStrictIsoTimestamp(meta.at)) return undefined
  return {at: meta.at}
}

function isStrictIsoTimestamp(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', zone, offsetSign, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const millisecond = Number(fraction.padEnd(3, '0'))
  const offsetHour = Number(offsetHourText ?? 0)
  const offsetMinute = Number(offsetMinuteText ?? 0)
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) return false

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  const offset = zone === 'Z' ? 0 : (offsetSign === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute)
  const local = new Date(parsed + offset * 60_000)
  return local.getUTCFullYear() === year &&
    local.getUTCMonth() + 1 === month &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hour &&
    local.getUTCMinutes() === minute &&
    local.getUTCSeconds() === second &&
    local.getUTCMilliseconds() === millisecond
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function withMeta(event: Record<string, unknown>, meta: {at: string} | undefined) {
  return meta ? {...event, meta} : event
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
