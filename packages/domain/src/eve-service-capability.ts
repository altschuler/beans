import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto'

export type EveServiceCapabilityPurpose = 'chat-session' | 'categorization-task' | 'categorization-trace'

export type EveServiceCapabilityScope =
  | {purpose: 'chat-session'; teamId: string; userId: string; chatId: string}
  | {purpose: 'categorization-task'; teamId: string; userId: string; appRunId: string; targetBankTransactionIds?: string[]}
  | {purpose: 'categorization-trace'; teamId: string; userId: string; appRunId: string; eveSessionId: string}

export type EveServiceCapabilityClaims = EveServiceCapabilityScope & {
  audience: string
  issuedAt: Date
  expiresAt: Date
  tokenId: string
}

export type MintEveServiceCapabilityOptions = {
  secret: string
  audience?: string
  now?: Date
  ttlSeconds?: number
}

export type VerifyEveServiceCapabilityOptions = {
  secret: string
  audience?: string
  now?: Date
  clockSkewSeconds?: number
}

export type EveServiceCapabilityErrorCode =
  | 'EVE_CAPABILITY_INVALID_SECRET'
  | 'EVE_CAPABILITY_INVALID_TTL'
  | 'EVE_CAPABILITY_INVALID_SCOPE'
  | 'EVE_CAPABILITY_MALFORMED'
  | 'EVE_CAPABILITY_INVALID_SIGNATURE'
  | 'EVE_CAPABILITY_INVALID_CLAIMS'
  | 'EVE_CAPABILITY_EXPIRED'
  | 'EVE_CAPABILITY_NOT_YET_VALID'

export class EveServiceCapabilityError extends Error {
  constructor(readonly code: EveServiceCapabilityErrorCode, message: string) {
    super(message)
    this.name = 'EveServiceCapabilityError'
  }
}

const tokenHeader = {alg: 'HS256', typ: 'PENGE_EVE_CAPABILITY', v: 1} as const
const defaultAudience = 'penge-eve-runtime'
const defaultTtlSeconds = 60
const maxTtlSeconds = 5 * 60

type CapabilityPayload = {
  v: 1
  aud: string
  pur: EveServiceCapabilityPurpose
  teamId: string
  userId: string
  chatId?: string
  appRunId?: string
  eveSessionId?: string
  targetBankTransactionIds?: string[]
  iat: number
  exp: number
  jti: string
}

export function mintEveServiceCapability(scope: EveServiceCapabilityScope, options: MintEveServiceCapabilityOptions) {
  assertSecret(options.secret)
  assertScope(scope)

  const ttlSeconds = options.ttlSeconds ?? defaultTtlSeconds
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > maxTtlSeconds) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_TTL', `Eve capability ttlSeconds must be between 1 and ${maxTtlSeconds}`)
  }

  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const payload: CapabilityPayload = {
    v: 1,
    aud: options.audience ?? defaultAudience,
    pur: scope.purpose,
    teamId: scope.teamId,
    userId: scope.userId,
    ...(scope.purpose === 'chat-session'
      ? {chatId: scope.chatId}
      : scope.purpose === 'categorization-task'
        ? {
            appRunId: scope.appRunId,
            ...(scope.targetBankTransactionIds ? {targetBankTransactionIds: scope.targetBankTransactionIds} : {}),
          }
        : {appRunId: scope.appRunId, eveSessionId: scope.eveSessionId}),
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: randomUUID(),
  }

  const signingInput = `${base64UrlJson(tokenHeader)}.${base64UrlJson(payload)}`
  return `${signingInput}.${signature(signingInput, options.secret)}`
}

export function verifyEveServiceCapability(token: string, options: VerifyEveServiceCapabilityOptions): EveServiceCapabilityClaims {
  assertSecret(options.secret)

  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_MALFORMED', 'Eve capability must have three dot-separated parts')
  }

  const [encodedHeader, encodedPayload, actualSignature] = parts as [string, string, string]
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const expectedSignature = signature(signingInput, options.secret)
  if (!safeEqual(actualSignature, expectedSignature)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SIGNATURE', 'Eve capability signature is invalid')
  }

  const decodedHeader = decodeBase64UrlJson(encodedHeader)
  if (decodedHeader.alg !== tokenHeader.alg || decodedHeader.typ !== tokenHeader.typ || decodedHeader.v !== tokenHeader.v) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability header is invalid')
  }

  const payload = decodeBase64UrlJson(encodedPayload)
  return claimsFromPayload(payload, options)
}

function claimsFromPayload(payload: Record<string, unknown>, options: VerifyEveServiceCapabilityOptions): EveServiceCapabilityClaims {
  if (payload.v !== 1 || payload.aud !== (options.audience ?? defaultAudience)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability claims are invalid')
  }
  if (!isNonEmptyString(payload.teamId) || !isNonEmptyString(payload.userId) || !isNonEmptyString(payload.jti)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability scope is invalid')
  }
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || Number(payload.exp) <= Number(payload.iat)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability timestamps are invalid')
  }

  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const skew = options.clockSkewSeconds ?? 0
  const issuedAtSeconds = Number(payload.iat)
  const expiresAtSeconds = Number(payload.exp)
  if (now > expiresAtSeconds + skew) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_EXPIRED', 'Eve capability is expired')
  }
  if (now + skew < issuedAtSeconds) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_NOT_YET_VALID', 'Eve capability is not yet valid')
  }

  const common = {
    audience: String(payload.aud),
    teamId: payload.teamId,
    userId: payload.userId,
    issuedAt: new Date(issuedAtSeconds * 1000),
    expiresAt: new Date(expiresAtSeconds * 1000),
    tokenId: payload.jti,
  }

  if (payload.pur === 'chat-session' && isNonEmptyString(payload.chatId) && payload.appRunId === undefined) {
    return {...common, purpose: 'chat-session', chatId: payload.chatId}
  }
  if (payload.pur === 'categorization-task' && isNonEmptyString(payload.appRunId) && payload.chatId === undefined && payload.eveSessionId === undefined) {
    if (payload.targetBankTransactionIds !== undefined && !isNonEmptyStringArray(payload.targetBankTransactionIds)) {
      throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability target scope is invalid')
    }
    return {
      ...common,
      purpose: 'categorization-task',
      appRunId: payload.appRunId,
      ...(payload.targetBankTransactionIds ? {targetBankTransactionIds: payload.targetBankTransactionIds} : {}),
    }
  }
  if (
    payload.pur === 'categorization-trace' &&
    isNonEmptyString(payload.appRunId) &&
    isNonEmptyString(payload.eveSessionId) &&
    payload.chatId === undefined &&
    payload.targetBankTransactionIds === undefined
  ) {
    return {...common, purpose: 'categorization-trace', appRunId: payload.appRunId, eveSessionId: payload.eveSessionId}
  }

  throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability purpose scope is invalid')
}

function assertScope(scope: EveServiceCapabilityScope) {
  if (!isNonEmptyString(scope.teamId) || !isNonEmptyString(scope.userId)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SCOPE', 'Eve capability requires teamId and userId')
  }
  if (scope.purpose === 'chat-session' && !isNonEmptyString(scope.chatId)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SCOPE', 'Chat eve capability requires chatId')
  }
  if (scope.purpose !== 'chat-session' && !isNonEmptyString(scope.appRunId)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SCOPE', 'Categorization eve capability requires appRunId')
  }
  if (scope.purpose === 'categorization-task' && scope.targetBankTransactionIds !== undefined && !isNonEmptyStringArray(scope.targetBankTransactionIds)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SCOPE', 'Categorization eve capability target ids must be non-empty strings')
  }
  if (scope.purpose === 'categorization-trace' && !isNonEmptyString(scope.eveSessionId)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SCOPE', 'Categorization trace capability requires eveSessionId')
  }
}

function assertSecret(secret: string) {
  if (!isNonEmptyString(secret) || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SECRET', 'Eve capability secret must be at least 32 bytes')
  }
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) return decoded as Record<string, unknown>
  } catch {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_MALFORMED', 'Eve capability JSON is malformed')
  }
  throw new EveServiceCapabilityError('EVE_CAPABILITY_MALFORMED', 'Eve capability JSON is malformed')
}

function signature(signingInput: string, secret: string) {
  return createHmac('sha256', secret).update(signingInput).digest('base64url')
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}
