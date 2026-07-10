import '@tanstack/react-start/server-only'

import {resolveTextToResponses, type InputRequest} from 'eve/client'
import {parseTeamChatClientCurrentPage, type TeamChatClientContext} from '@penge/domain/team-chat-ui-context'
import {getSessionFromRequest} from '@/auth/session.server'
import {
  attachChatSessionStart,
  claimChatApprovalResponses,
  currentChatSessionHasCommittedTerminalBoundary,
  getAuthorizedChatRuntimeMapping,
  listPendingChatApprovals,
  markChatFollowUpDeliveryAcknowledged,
  markChatFollowUpDeliveryAmbiguous,
  reapStaleChatAdmissions,
  releaseDefinitiveChatFollowUpRejection,
  releaseDefinitiveChatStartRejection,
  reserveChatFollowUp,
  reserveChatSessionStart,
  type PendingChatApproval,
} from './chat-runtime-repository.server'
import {
  CHAT_ATTACHMENT_RETRY_DELAYS_MS,
  CHAT_MAX_NDJSON_LINE_BYTES,
  CHAT_RECEIPT_ACK_RETRY_DELAYS_MS,
  CHAT_UPSTREAM_POST_TIMEOUT_MS,
} from './chat-runtime-constants'
import {safeChatErrorCatalog} from './chat-error-catalog'
import {createChatEventNdjsonTransform} from './ndjson-transform.server'
import {reconcileChatRuntime} from './chat-reconciliation.server'
import {mintEveChatSessionCapability} from './service-capability.server'

const proxyPrefix = '/api/eve/chat'
const maxBodyBytes = 64 * 1024
const maxUpstreamReceiptBytes = 8 * 1024
const maxUpstreamErrorCharacters = 1_000
const definitivePreAdmissionStatuses = new Set([400, 401, 403, 404])
const maxMessageCharacters = 20_000
const maxInputResponses = 20
const maxRequestIdCharacters = 200
const sessionIdPattern = /^[A-Za-z0-9_-]{1,200}$/
const conflictMessage = 'Chat is already processing a turn'
const approvalConflictMessage = 'Use the displayed approval controls and reload the chat if needed.'

type ProxySession = {user: {id: string}}
type RuntimeMapping = Awaited<ReturnType<typeof getAuthorizedChatRuntimeMapping>>
type NonNullRuntimeMapping = Exclude<RuntimeMapping, null>

type ProxyRoute =
  | {kind: 'start'}
  | {kind: 'followUp'; sessionId: string}
  | {kind: 'stream'; sessionId: string; startIndex: number}

type ValidStartBody = {
  message: string
  clientContext?: TeamChatClientContext
}

type ValidFollowUpBody = {
  message?: string
  inputResponses?: Array<{requestId: string; optionId: 'approve' | 'deny'}>
  clientContext?: TeamChatClientContext
  continuationToken?: string
}

type EveChatProxyDependencies = {
  getSession(request: Request): Promise<ProxySession | null>
  getAuthorizedChatRuntimeMapping(input: {chatId: string; userId: string}): Promise<RuntimeMapping>
  reserveChatSessionStart: typeof reserveChatSessionStart
  reserveChatFollowUp: typeof reserveChatFollowUp
  attachChatSessionStart: typeof attachChatSessionStart
  releaseDefinitiveChatStartRejection: typeof releaseDefinitiveChatStartRejection
  releaseDefinitiveChatFollowUpRejection: typeof releaseDefinitiveChatFollowUpRejection
  markChatFollowUpDeliveryAcknowledged: typeof markChatFollowUpDeliveryAcknowledged
  markChatFollowUpDeliveryAmbiguous: typeof markChatFollowUpDeliveryAmbiguous
  reapStaleChatAdmissions: typeof reapStaleChatAdmissions
  listPendingChatApprovals(input: {chatId: string; eveSessionId: string; sessionOrdinal: number}): Promise<PendingChatApproval[]>
  claimChatApprovalResponses: typeof claimChatApprovalResponses
  currentChatSessionHasCommittedTerminalBoundary: typeof currentChatSessionHasCommittedTerminalBoundary
  mintChatCapability(input: {teamId: string; userId: string; chatId: string}): string
  createChatEventTransform?: typeof createChatEventNdjsonTransform
  reconcileChatRuntime: typeof reconcileChatRuntime
  fetch: typeof fetch
  createTimeoutSignal(ms: number): AbortSignal
  sleep(ms: number): Promise<void>
  warn(message: string, context: {count: number}): void
  env: Partial<Record<'PENGE_EVE_BASE_URL' | 'VITE_PUBLIC_APP_URL', string>>
}

export function createEveChatProxyHandler(deps: EveChatProxyDependencies) {
  return async function handleEveChatProxyRequest(request: Request, params: {chatId: string}) {
    const session = await deps.getSession(request)
    if (!session) return plainNoStoreResponse('Unauthorized', 401)

    const mapping = await deps.getAuthorizedChatRuntimeMapping({chatId: params.chatId, userId: session.user.id})
    if (!mapping) return plainNoStoreResponse('Not found', 404)

    const route = parseProxyRoute(request, params.chatId)
    if (!route) return plainNoStoreResponse('Not found', 404)

    if (route.kind !== 'start' && route.sessionId !== mapping.eveSessionId) {
      return plainNoStoreResponse('Not found', 404)
    }

    if (route.kind === 'stream') {
      const eveOrigin = configuredHttpOrigin(deps.env.PENGE_EVE_BASE_URL)
      if (!eveOrigin) return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
      return handleStream({deps, request, mapping, route, eveOrigin})
    }

    const appOrigin = configuredAppOrigin(deps.env.VITE_PUBLIC_APP_URL)
    const eveOrigin = configuredHttpOrigin(deps.env.PENGE_EVE_BASE_URL)
    if (!appOrigin || !eveOrigin) return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
    if (!hasTrustedPostOrigin(request, appOrigin)) return safeJsonResponse(403, {ok: false, error: 'Cross-origin chat requests are not allowed.'})
    if (hasBrowserCredentialHeader(request.headers)) {
      return safeJsonResponse(400, {ok: false, error: 'Browser authorization and identity headers are not accepted.'})
    }

    const parsedBody = await readBoundedJsonBody(request)
    if (!parsedBody.ok) return safeJsonResponse(parsedBody.status, {ok: false, error: parsedBody.error})

    if (route.kind === 'start') {
      const body = parseStartBody(parsedBody.value)
      if (!body) return invalidBodyResponse()
      return handleStart({deps, request, mapping, body, eveOrigin})
    }

    const body = parseFollowUpBody(parsedBody.value)
    if (!body) return invalidBodyResponse()
    return handleFollowUp({deps, request, mapping, body, route, eveOrigin})
  }
}

export const handleEveChatProxyRequest = createEveChatProxyHandler({
  getSession: getSessionFromRequest,
  getAuthorizedChatRuntimeMapping,
  reserveChatSessionStart,
  reserveChatFollowUp,
  attachChatSessionStart,
  releaseDefinitiveChatStartRejection,
  releaseDefinitiveChatFollowUpRejection,
  markChatFollowUpDeliveryAcknowledged,
  markChatFollowUpDeliveryAmbiguous,
  reapStaleChatAdmissions,
  listPendingChatApprovals,
  claimChatApprovalResponses,
  currentChatSessionHasCommittedTerminalBoundary,
  mintChatCapability: mintEveChatSessionCapability,
  createChatEventTransform: createChatEventNdjsonTransform,
  reconcileChatRuntime,
  fetch,
  createTimeoutSignal: ms => AbortSignal.timeout(ms),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  warn: (message, context) => console.warn(message, context),
  env: process.env,
})

async function handleStart(input: {
  deps: EveChatProxyDependencies
  request: Request
  mapping: NonNullRuntimeMapping
  body: ValidStartBody
  eveOrigin: string
}) {
  try {
    const stale = await input.deps.reapStaleChatAdmissions()
    if (stale.length > 0) input.deps.warn('Reaped stale Eve chat admissions', {count: stale.length})
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }

  let mapping = input.mapping
  let expectedTerminal: Parameters<typeof reserveChatSessionStart>[0]['expectedTerminal']
  if (
    (mapping.sessionState === 'completed' || mapping.sessionState === 'failed') &&
    mapping.eveSessionId && mapping.eveContinuationToken
  ) {
    const original = mapping
    try {
      const reconciliation = await input.deps.reconcileChatRuntime(mapping)
      if (reconciliation.status !== 'boundary' && reconciliation.status !== 'missing') return turnConflictResponse()
      const refreshed = await input.deps.getAuthorizedChatRuntimeMapping({chatId: mapping.chatId, userId: mapping.userId})
      if (
        !refreshed ||
        !refreshed.eveSessionId ||
        refreshed.eveSessionId !== original.eveSessionId ||
        refreshed.sessionOrdinal !== original.sessionOrdinal ||
        (refreshed.sessionState !== 'completed' && refreshed.sessionState !== 'failed')
      ) return turnConflictResponse()
      const hasBoundary = await input.deps.currentChatSessionHasCommittedTerminalBoundary({
        chatId: refreshed.chatId,
        eveSessionId: refreshed.eveSessionId,
        sessionOrdinal: refreshed.sessionOrdinal,
        state: refreshed.sessionState,
      })
      if (!hasBoundary) return turnConflictResponse()
      mapping = refreshed
      expectedTerminal = {
        eveSessionId: refreshed.eveSessionId,
        sessionOrdinal: refreshed.sessionOrdinal,
        sessionState: refreshed.sessionState,
        eveNextStreamIndex: refreshed.eveNextStreamIndex,
      }
    } catch {
      return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
    }
  }

  let prepared: PreparedEvePost
  try {
    prepared = prepareEvePost(input.deps, input.request, mapping, `${input.eveOrigin}/eve/v1/session`, input.body)
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }

  let reserved: NonNullRuntimeMapping | null
  try {
    reserved = await input.deps.reserveChatSessionStart({
      chatId: mapping.chatId,
      ...(expectedTerminal ? {expectedTerminal} : {}),
    })
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }
  if (!reserved || reserved.sessionState !== 'admitting' || !reserved.admissionId) return turnConflictResponse()
  if (prepared.signal.aborted) {
    await releaseStartSafely(input.deps, reserved)
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }

  const upstream = await postToEve(input.deps, prepared)
  if (!upstream.ok) {
    if (upstream.definitiveStatus !== undefined) {
      await releaseStartSafely(input.deps, reserved)
      return safeErrorResponse(upstream.definitiveStatus, 'CHAT_UNAVAILABLE')
    }
    return safeErrorResponse(upstream.status, 'CHAT_UNAVAILABLE')
  }

  const receipt = parseStartReceipt(upstream.value)
  if (!receipt) return safeErrorResponse(502, 'CHAT_UNAVAILABLE')

  const attached = await attachCapturedStart(input.deps, input.request, {
    chatId: reserved.chatId,
    sessionOrdinal: reserved.sessionOrdinal,
    admissionId: reserved.admissionId,
    eveSessionId: receipt.sessionId,
    eveContinuationToken: receipt.continuationToken,
  })
  if (!attached) return safeErrorResponse(503, 'CHAT_UNAVAILABLE')

  return safeJsonResponse(202, {ok: true, ...receipt}, receipt.sessionId)
}

async function handleFollowUp(input: {
  deps: EveChatProxyDependencies
  request: Request
  mapping: NonNullRuntimeMapping
  body: ValidFollowUpBody
  route: Extract<ProxyRoute, {kind: 'followUp'}>
  eveOrigin: string
}) {
  if (
    input.mapping.sessionState !== 'waiting' ||
    !input.mapping.eveSessionId ||
    !input.mapping.eveContinuationToken ||
    (input.body.continuationToken !== undefined && input.body.continuationToken !== input.mapping.eveContinuationToken)
  ) return turnConflictResponse()

  let pending: PendingChatApproval[]
  try {
    pending = await input.deps.listPendingChatApprovals({
      chatId: input.mapping.chatId,
      eveSessionId: input.mapping.eveSessionId,
      sessionOrdinal: input.mapping.sessionOrdinal,
    })
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }
  const approvalPlan = resolveApprovalPlan(input.body, pending)
  if (!approvalPlan.ok) return safeJsonResponse(409, {ok: false, error: approvalConflictMessage})

  const upstreamBody = {
    ...(approvalPlan.message !== undefined ? {message: approvalPlan.message} : {}),
    ...(approvalPlan.responses.length > 0 ? {inputResponses: approvalPlan.responses} : {}),
    ...(input.body.clientContext ? {clientContext: input.body.clientContext} : {}),
    continuationToken: input.mapping.eveContinuationToken,
  }
  let prepared: PreparedEvePost
  try {
    prepared = prepareEvePost(
      input.deps,
      input.request,
      input.mapping,
      `${input.eveOrigin}/eve/v1/session/${encodeURIComponent(input.route.sessionId)}`,
      upstreamBody,
    )
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }

  let reserved: NonNullRuntimeMapping | null
  try {
    reserved = await input.deps.reserveChatFollowUp({
      chatId: input.mapping.chatId,
      eveSessionId: input.mapping.eveSessionId,
      sessionOrdinal: input.mapping.sessionOrdinal,
    })
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }
  if (
    !reserved || reserved.sessionState !== 'running' || !reserved.turnStartedAt ||
    !reserved.admissionId || reserved.followUpPreTurnCursor === null ||
    reserved.followUpDeliveryState !== 'pending'
  ) return turnConflictResponse()

  if (approvalPlan.responses.length > 0) {
    try {
      const claim = await input.deps.claimChatApprovalResponses({
        chatId: reserved.chatId,
        eveSessionId: input.mapping.eveSessionId,
        sessionOrdinal: reserved.sessionOrdinal,
        turnStartedAt: reserved.turnStartedAt,
        admissionId: reserved.admissionId,
        preTurnCursor: reserved.followUpPreTurnCursor,
        responses: approvalPlan.responses,
      })
      if (claim.status !== 'claimed') {
        await releaseFollowUpSafely(input.deps, reserved, input.mapping.eveSessionId, [])
        return safeJsonResponse(409, {ok: false, error: approvalConflictMessage})
      }
    } catch {
      await releaseFollowUpSafely(
        input.deps,
        reserved,
        input.mapping.eveSessionId,
        approvalPlan.responses,
        true,
      )
      return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
    }
  }

  if (prepared.signal.aborted) {
    await releaseFollowUpSafely(input.deps, reserved, input.mapping.eveSessionId, approvalPlan.responses, true)
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }
  const upstream = await postToEve(input.deps, prepared)
  if (!upstream.ok) {
    if (upstream.definitiveStatus !== undefined) {
      await releaseFollowUpSafely(input.deps, reserved, input.mapping.eveSessionId, approvalPlan.responses)
      return safeErrorResponse(upstream.definitiveStatus, 'CHAT_UNAVAILABLE')
    }
    await markFollowUpAmbiguousSafely(input.deps, reserved, input.mapping.eveSessionId)
    return safeErrorResponse(upstream.status, 'CHAT_UNAVAILABLE')
  }

  const receipt = parseFollowUpReceipt(upstream.value, input.mapping.eveSessionId)
  if (!receipt) {
    await markFollowUpAmbiguousSafely(input.deps, reserved, input.mapping.eveSessionId)
    return safeErrorResponse(502, 'CHAT_UNAVAILABLE')
  }
  const acknowledged = await acknowledgeFollowUpReceipt(input.deps, {
    chatId: reserved.chatId,
    eveSessionId: input.mapping.eveSessionId,
    sessionOrdinal: reserved.sessionOrdinal,
    admissionId: reserved.admissionId,
    preTurnCursor: reserved.followUpPreTurnCursor,
  })
  if (!acknowledged) return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  return safeJsonResponse(200, receipt, receipt.sessionId)
}

type PreparedEvePost = {
  url: string
  body: string
  capability: string
  signal: AbortSignal
  timeoutSignal: AbortSignal
}

function prepareEvePost(
  deps: EveChatProxyDependencies,
  request: Request,
  mapping: NonNullRuntimeMapping,
  url: string,
  body: object,
): PreparedEvePost {
  if (request.signal.aborted) throw new Error('Chat request was already aborted')
  const capability = deps.mintChatCapability({
    teamId: mapping.teamId,
    userId: mapping.userId,
    chatId: mapping.chatId,
  })
  const timeoutSignal = deps.createTimeoutSignal(CHAT_UPSTREAM_POST_TIMEOUT_MS)
  return {
    url,
    body: JSON.stringify(body),
    capability,
    signal: AbortSignal.any([request.signal, timeoutSignal]),
    timeoutSignal,
  }
}

async function postToEve(
  deps: EveChatProxyDependencies,
  prepared: PreparedEvePost,
): Promise<{ok: true; value: unknown} | {ok: false; status: number; definitiveStatus?: number}> {
  let response: Response
  try {
    response = await deps.fetch(prepared.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${prepared.capability}`,
        'content-type': 'application/json',
      },
      body: prepared.body,
      redirect: 'error',
      signal: prepared.signal,
    })
  } catch {
    return {ok: false, status: prepared.timeoutSignal.aborted ? 504 : 502}
  }

  const receipt = await readBoundedJsonStream(
    response.body,
    maxUpstreamReceiptBytes,
    response.headers.get('content-length'),
  )
  if (!receipt.ok) return {ok: false, status: 502}

  if (!response.ok) {
    return definitivePreAdmissionStatuses.has(response.status) && isStrictEveRejectionReceipt(receipt.value, response.status)
      ? {ok: false, status: response.status, definitiveStatus: response.status}
      : {ok: false, status: 502}
  }
  return {ok: true, value: receipt.value}
}

async function attachCapturedStart(
  deps: EveChatProxyDependencies,
  request: Request,
  captured: Parameters<typeof attachChatSessionStart>[0],
) {
  const delays: readonly number[] = [0, ...CHAT_ATTACHMENT_RETRY_DELAYS_MS]
  for (const [index, delay] of delays.entries()) {
    if (request.signal.aborted) return null
    if (delay > 0) await deps.sleep(delay)
    if (request.signal.aborted) return null
    try {
      const attached = await deps.attachChatSessionStart(captured)
      if (attached) return attached
    } catch {
      // The captured Eve handle is immutable; only this conditional attachment is retried.
    }
    if (index === delays.length - 1) return null
  }
  return null
}

function resolveApprovalPlan(
  body: ValidFollowUpBody,
  pending: Awaited<ReturnType<EveChatProxyDependencies['listPendingChatApprovals']>>,
): {ok: true; message?: string; responses: Array<{requestId: string; optionId: 'approve' | 'deny'}>} | {ok: false} {
  const requests = pending.map(toEveApprovalRequest)
  const textResponses = body.message === undefined ? [] : resolveTextToResponses(body.message, requests)

  if (body.inputResponses) {
    if (textResponses.length > 0) return {ok: false}
    for (const response of body.inputResponses) {
      const row = pending.find(candidate => candidate.requestId === response.requestId)
      if (!row || row.resolutionStatus !== 'pending' || (response.optionId === 'approve' && row.projectionStatus !== 'ready')) {
        return {ok: false}
      }
    }
    return {ok: true, ...(body.message !== undefined ? {message: body.message} : {}), responses: body.inputResponses}
  }

  if (textResponses.length === 0) return {ok: true, ...(body.message !== undefined ? {message: body.message} : {}), responses: []}
  const literal = body.message?.trim().toLowerCase()
  if (
    pending.length !== 1 ||
    textResponses.length !== 1 ||
    (literal !== 'approve' && literal !== 'deny')
  ) return {ok: false}

  const response = textResponses[0]
  const row = pending[0]
  if (!response || !row || response.requestId !== row.requestId || response.optionId !== literal) return {ok: false}
  if (literal === 'approve' && row.projectionStatus !== 'ready') return {ok: false}
  return {ok: true, responses: [{requestId: row.requestId, optionId: literal}]}
}

function toEveApprovalRequest(row: Awaited<ReturnType<EveChatProxyDependencies['listPendingChatApprovals']>>[number]): InputRequest {
  return {
    requestId: row.requestId,
    prompt: 'Approve this change?',
    display: 'confirmation',
    options: [
      {id: 'approve', label: 'Approve', style: 'primary'},
      {id: 'deny', label: 'Deny', style: 'danger'},
    ],
    action: {kind: 'tool-call', callId: row.callId, toolName: row.toolName, input: {}},
  }
}

function parseProxyRoute(request: Request, chatId: string): ProxyRoute | null {
  const url = new URL(request.url)
  if (url.hash) return null
  const canonicalChatPrefix = `${proxyPrefix}/${encodeURIComponent(chatId)}`
  if (!url.pathname.startsWith(`${canonicalChatPrefix}/`)) return null
  const suffix = url.pathname.slice(canonicalChatPrefix.length)

  if (request.method === 'POST' && url.search === '') {
    if (suffix === '/eve/v1/session') return {kind: 'start'}
    const followUp = /^\/eve\/v1\/session\/([A-Za-z0-9_-]{1,200})$/.exec(suffix)
    return followUp?.[1] && sessionIdPattern.test(followUp[1])
      ? {kind: 'followUp', sessionId: followUp[1]}
      : null
  }

  if (request.method !== 'GET') return null
  const stream = /^\/eve\/v1\/session\/([A-Za-z0-9_-]{1,200})\/stream$/.exec(suffix)
  if (!stream?.[1] || !sessionIdPattern.test(stream[1])) return null
  const query = /^\?startIndex=(0|[1-9]\d*)$/.exec(url.search)
  if (!query?.[1]) return null
  const startIndex = Number(query[1])
  return Number.isSafeInteger(startIndex) ? {kind: 'stream', sessionId: stream[1], startIndex} : null
}

async function handleStream(input: {
  deps: EveChatProxyDependencies
  request: Request
  mapping: NonNullRuntimeMapping
  route: Extract<ProxyRoute, {kind: 'stream'}>
  eveOrigin: string
}) {
  if (input.route.startIndex > input.mapping.eveNextStreamIndex) {
    return safeJsonResponse(409, {
      ok: false,
      error: 'The chat stream cursor is ahead of saved history. Reload and bootstrap the chat again.',
    })
  }
  if (!input.mapping.eveSessionId || input.mapping.eveSessionId !== input.route.sessionId) {
    return plainNoStoreResponse('Not found', 404)
  }

  let capability: string
  try {
    capability = input.deps.mintChatCapability({
      teamId: input.mapping.teamId,
      userId: input.mapping.userId,
      chatId: input.mapping.chatId,
    })
  } catch {
    return safeErrorResponse(503, 'CHAT_UNAVAILABLE')
  }

  let upstream: Response
  try {
    upstream = await input.deps.fetch(
      `${input.eveOrigin}/eve/v1/session/${encodeURIComponent(input.route.sessionId)}/stream?startIndex=${input.route.startIndex}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/x-ndjson',
          authorization: `Bearer ${capability}`,
        },
        credentials: 'omit',
        redirect: 'error',
        signal: input.request.signal,
      },
    )
  } catch {
    return safeErrorResponse(502, 'CHAT_STREAM_INTERRUPTED')
  }

  if (!upstream.ok || !upstream.body || !isNdjsonContentType(upstream.headers.get('content-type'))) {
    await upstream.body?.cancel().catch(() => undefined)
    return safeErrorResponse(502, 'CHAT_STREAM_INTERRUPTED')
  }

  const preflightBody = await preflightFirstNdjsonEvent(upstream.body)
  if (!preflightBody) return safeErrorResponse(502, 'CHAT_STREAM_INTERRUPTED')

  const createTransform = input.deps.createChatEventTransform ?? createChatEventNdjsonTransform
  let transform: TransformStream<Uint8Array, Uint8Array>
  try {
    transform = createTransform({
      startIndex: input.route.startIndex,
      chatId: input.mapping.chatId,
      eveSessionId: input.mapping.eveSessionId,
      sessionOrdinal: input.mapping.sessionOrdinal,
      scope: {teamId: input.mapping.teamId, userId: input.mapping.userId},
    })
  } catch {
    await preflightBody.cancel().catch(() => undefined)
    return safeErrorResponse(502, 'CHAT_STREAM_INTERRUPTED')
  }

  return new Response(preflightBody.pipeThrough(transform), {
    status: 200,
    headers: {
      'cache-control': 'no-store, no-transform',
      'content-type': 'application/x-ndjson',
    },
  })
}

async function preflightFirstNdjsonEvent(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const consumed: Uint8Array[] = []
  let line: number[] = []
  let preludeBytes = 0
  let foundEvent = false

  const validateLine = () => {
    let bytes = Uint8Array.from(line)
    line = []
    if (bytes.at(-1) === 0x0d) bytes = bytes.slice(0, -1)
    let text: string
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    } catch {
      return false
    }
    if (text.trim().length === 0) return true
    try {
      JSON.parse(text)
      foundEvent = true
      return true
    } catch {
      return false
    }
  }

  try {
    while (!foundEvent) {
      const {done, value} = await reader.read()
      if (done) {
        if (line.length > 0 && !validateLine()) return null
        break
      }
      consumed.push(value)
      for (const byte of value) {
        preludeBytes += 1
        if (preludeBytes > CHAT_MAX_NDJSON_LINE_BYTES) {
          await reader.cancel().catch(() => undefined)
          return null
        }
        if (byte === 0x0a) {
          if (!validateLine()) {
            await reader.cancel().catch(() => undefined)
            return null
          }
          if (foundEvent) break
          continue
        }
        line.push(byte)
        if (line.length > CHAT_MAX_NDJSON_LINE_BYTES) {
          await reader.cancel().catch(() => undefined)
          return null
        }
      }
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return null
  }

  let consumedIndex = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = consumed[consumedIndex]
      if (chunk) {
        consumedIndex += 1
        controller.enqueue(chunk)
        return
      }
      try {
        const next = await reader.read()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

function isNdjsonContentType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/x-ndjson'
}

function configuredAppOrigin(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url.origin
      : null
  } catch {
    return null
  }
}

function configuredHttpOrigin(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) return null
    return url.origin
  } catch {
    return null
  }
}

function hasTrustedPostOrigin(request: Request, trustedOrigin: string) {
  const value = request.headers.get('origin')
  if (!value || value.includes(',')) return false
  try {
    const origin = new URL(value)
    return (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      !origin.username && !origin.password &&
      value === origin.origin &&
      origin.origin === trustedOrigin
  } catch {
    return false
  }
}

function hasBrowserCredentialHeader(headers: Headers) {
  for (const [name] of headers) {
    const normalized = name.toLowerCase()
    if (
      normalized === 'authorization' ||
      normalized === 'proxy-authorization' ||
      normalized === 'x-vercel-trusted-oidc-idp-token' ||
      normalized.startsWith('x-penge-')
    ) return true
  }
  return false
}

async function readBoundedJsonStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  contentLength: string | null,
): Promise<{ok: true; value: unknown} | {ok: false}> {
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await body?.cancel().catch(() => undefined)
    return {ok: false}
  }
  if (!body) return {ok: false}

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return {ok: false}
      }
      chunks.push(value)
    }
  } catch {
    return {ok: false}
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return {ok: true, value: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))}
  } catch {
    return {ok: false}
  }
}

async function readBoundedJsonBody(request: Request): Promise<
  | {ok: true; value: unknown}
  | {ok: false; status: 400 | 413; error: string}
> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBodyBytes) {
    return {ok: false, status: 413, error: 'Chat request body is too large.'}
  }

  if (!request.body) return {ok: false, status: 400, error: 'Invalid JSON request body.'}
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBodyBytes) {
        await reader.cancel().catch(() => undefined)
        return {ok: false, status: 413, error: 'Chat request body is too large.'}
      }
      chunks.push(value)
    }
  } catch {
    return {ok: false, status: 400, error: 'Invalid JSON request body.'}
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return {ok: true, value: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))}
  } catch {
    return {ok: false, status: 400, error: 'Invalid JSON request body.'}
  }
}

function parseStartBody(value: unknown): ValidStartBody | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['message', 'clientContext'])) return null
  const message = parseMessage(value.message)
  if (!message) return null
  const clientContext = reconstructClientContext(value.clientContext)
  return {message, ...(clientContext ? {clientContext} : {})}
}

function parseFollowUpBody(value: unknown): ValidFollowUpBody | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['message', 'inputResponses', 'clientContext', 'continuationToken'])) return null

  let message: string | undefined
  if (Object.hasOwn(value, 'message')) {
    message = parseMessage(value.message) ?? undefined
    if (message === undefined) return null
  }

  let inputResponses: ValidFollowUpBody['inputResponses']
  if (Object.hasOwn(value, 'inputResponses')) {
    if (!Array.isArray(value.inputResponses) || value.inputResponses.length < 1 || value.inputResponses.length > maxInputResponses) return null
    const seen = new Set<string>()
    inputResponses = []
    for (const response of value.inputResponses) {
      if (!isRecord(response) || !hasOnlyKeys(response, ['requestId', 'optionId'])) return null
      if (
        typeof response.requestId !== 'string' ||
        !response.requestId ||
        response.requestId.length > maxRequestIdCharacters ||
        (response.optionId !== 'approve' && response.optionId !== 'deny') ||
        seen.has(response.requestId)
      ) return null
      seen.add(response.requestId)
      inputResponses.push({requestId: response.requestId, optionId: response.optionId})
    }
  }

  if (message === undefined && inputResponses === undefined) return null
  if (
    Object.hasOwn(value, 'continuationToken') &&
    (typeof value.continuationToken !== 'string' || !value.continuationToken || value.continuationToken.length > 1_000)
  ) return null
  const clientContext = reconstructClientContext(value.clientContext)
  return {
    ...(message !== undefined ? {message} : {}),
    ...(inputResponses ? {inputResponses} : {}),
    ...(clientContext ? {clientContext} : {}),
    ...(typeof value.continuationToken === 'string' ? {continuationToken: value.continuationToken} : {}),
  }
}

function parseMessage(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxMessageCharacters
    ? value
    : null
}

function reconstructClientContext(value: unknown): TeamChatClientContext | null {
  const currentPage = parseTeamChatClientCurrentPage(value)
  return currentPage ? {currentPage} : null
}

function isStrictEveRejectionReceipt(value: unknown, status: number) {
  if (
    !isRecord(value) ||
    value.ok !== false ||
    typeof value.error !== 'string' ||
    value.error.trim().length === 0 ||
    value.error.length > maxUpstreamErrorCharacters
  ) return false
  if (status === 401 || status === 403) {
    return hasOnlyKeys(value, ['ok', 'error', 'code']) &&
      typeof value.code === 'string' &&
      value.code.trim().length > 0 &&
      value.code.length <= 200
  }
  return hasOnlyKeys(value, ['ok', 'error'])
}

function parseStartReceipt(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ['ok', 'sessionId', 'continuationToken']) || value.ok !== true) return null
  const {sessionId, continuationToken} = value
  return typeof sessionId === 'string' && sessionIdPattern.test(sessionId) &&
    typeof continuationToken === 'string' && continuationToken.length > 0 && continuationToken.length <= 1_000
    ? {sessionId, continuationToken}
    : null
}

function parseFollowUpReceipt(value: unknown, expectedSessionId: string) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['ok', 'sessionId']) ||
    value.ok !== true ||
    value.sessionId !== expectedSessionId
  ) return null
  return {ok: true as const, sessionId: expectedSessionId}
}

async function releaseStartSafely(deps: EveChatProxyDependencies, reserved: NonNullRuntimeMapping) {
  if (!reserved.admissionId) return false
  try {
    return await deps.releaseDefinitiveChatStartRejection({
      chatId: reserved.chatId,
      sessionOrdinal: reserved.sessionOrdinal,
      admissionId: reserved.admissionId,
    })
  } catch {
    return false
  }
}

async function acknowledgeFollowUpReceipt(
  deps: EveChatProxyDependencies,
  exact: Parameters<typeof markChatFollowUpDeliveryAcknowledged>[0],
) {
  let attempt = 0
  for (;;) {
    try {
      const result = await deps.markChatFollowUpDeliveryAcknowledged(exact)
      return result.status !== 'stale'
    } catch {
      // A validated Eve receipt is known delivery. Keep its marker rollback-ineligible even if
      // the browser disconnects; retry with capped backoff for as long as this process is alive.
    }
    const delay = CHAT_RECEIPT_ACK_RETRY_DELAYS_MS[
      Math.min(attempt, CHAT_RECEIPT_ACK_RETRY_DELAYS_MS.length - 1)
    ]!
    attempt += 1
    await deps.sleep(delay).catch(() => undefined)
  }
}

async function markFollowUpAmbiguousSafely(
  deps: EveChatProxyDependencies,
  reserved: NonNullRuntimeMapping,
  eveSessionId: string,
) {
  if (!reserved.admissionId || reserved.followUpPreTurnCursor === null) return false
  try {
    return await deps.markChatFollowUpDeliveryAmbiguous({
      chatId: reserved.chatId,
      eveSessionId,
      sessionOrdinal: reserved.sessionOrdinal,
      admissionId: reserved.admissionId,
      preTurnCursor: reserved.followUpPreTurnCursor,
    })
  } catch {
    return false
  }
}

async function releaseFollowUpSafely(
  deps: EveChatProxyDependencies,
  reserved: NonNullRuntimeMapping,
  eveSessionId: string,
  claimedResponses: ValidFollowUpBody['inputResponses'],
  allowUnclaimedResponses = false,
) {
  if (!reserved.turnStartedAt || !reserved.admissionId || reserved.followUpPreTurnCursor === null) return false
  try {
    return await deps.releaseDefinitiveChatFollowUpRejection({
      chatId: reserved.chatId,
      eveSessionId,
      sessionOrdinal: reserved.sessionOrdinal,
      turnStartedAt: reserved.turnStartedAt,
      admissionId: reserved.admissionId,
      preTurnCursor: reserved.followUpPreTurnCursor,
      claimedResponses: claimedResponses ?? [],
      allowUnclaimedResponses,
    })
  } catch {
    return false
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowlist = new Set(allowed)
  return Object.keys(value).every(key => allowlist.has(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function plainNoStoreResponse(body: string, status: number) {
  return new Response(body, {status, headers: {'cache-control': 'no-store'}})
}

function invalidBodyResponse() {
  return safeJsonResponse(400, {ok: false, error: 'Invalid chat request body.'})
}

function turnConflictResponse() {
  return safeJsonResponse(409, {ok: false, error: conflictMessage})
}

function safeErrorResponse(status: number, code: keyof typeof safeChatErrorCatalog) {
  return safeJsonResponse(status, {ok: false, error: safeChatErrorCatalog[code]})
}

function safeJsonResponse(status: number, body: object, sessionId?: string) {
  const headers = new Headers({'cache-control': 'no-store', 'content-type': 'application/json'})
  if (sessionId) headers.set('x-eve-session-id', sessionId)
  return new Response(JSON.stringify(body), {status, headers})
}
