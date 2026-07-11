import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto'

export type EveServiceCapabilityScope = {purpose: 'chat-session'; teamId: string; userId: string; chatId: string}
export type EveServiceCapabilityClaims = EveServiceCapabilityScope & {
  audience: string
  issuedAt: Date
  expiresAt: Date
  tokenId: string
}

export type MintEveServiceCapabilityOptions = {secret: string; audience?: string; now?: Date; ttlSeconds?: number}
export type VerifyEveServiceCapabilityOptions = {secret: string; audience?: string; now?: Date; clockSkewSeconds?: number}
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
const maxTtlSeconds = 5 * 60

type Payload = {
  v: 1
  aud: string
  pur: 'chat-session'
  teamId: string
  userId: string
  chatId: string
  iat: number
  exp: number
  jti: string
}

export function mintEveServiceCapability(scope: EveServiceCapabilityScope, options: MintEveServiceCapabilityOptions) {
  assertSecret(options.secret)
  if (![scope.teamId, scope.userId, scope.chatId].every(isNonEmptyString)) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SCOPE', 'Chat eve capability requires teamId, userId, and chatId')
  }
  const ttlSeconds = options.ttlSeconds ?? 60
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > maxTtlSeconds) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_TTL', `Eve capability ttlSeconds must be between 1 and ${maxTtlSeconds}`)
  }
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const payload: Payload = {
    v: 1,
    aud: options.audience ?? defaultAudience,
    pur: 'chat-session',
    teamId: scope.teamId,
    userId: scope.userId,
    chatId: scope.chatId,
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
  if (parts.length !== 3 || parts.some(part => !part)) throw malformed()
  const [headerPart, payloadPart, actualSignature] = parts as [string, string, string]
  const signingInput = `${headerPart}.${payloadPart}`
  if (!safeEqual(actualSignature, signature(signingInput, options.secret))) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SIGNATURE', 'Eve capability signature is invalid')
  }
  const header = decodeJson(headerPart)
  if (header.alg !== tokenHeader.alg || header.typ !== tokenHeader.typ || header.v !== tokenHeader.v) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability header is invalid')
  }
  const payload = decodeJson(payloadPart)
  if (
    payload.v !== 1 || payload.aud !== (options.audience ?? defaultAudience) || payload.pur !== 'chat-session' ||
    !isNonEmptyString(payload.teamId) || !isNonEmptyString(payload.userId) || !isNonEmptyString(payload.chatId) || !isNonEmptyString(payload.jti) ||
    !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || Number(payload.exp) <= Number(payload.iat)
  ) throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_CLAIMS', 'Eve capability claims are invalid')

  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const skew = options.clockSkewSeconds ?? 0
  const issuedAt = Number(payload.iat)
  const expiresAt = Number(payload.exp)
  if (now > expiresAt + skew) throw new EveServiceCapabilityError('EVE_CAPABILITY_EXPIRED', 'Eve capability is expired')
  if (now + skew < issuedAt) throw new EveServiceCapabilityError('EVE_CAPABILITY_NOT_YET_VALID', 'Eve capability is not yet valid')
  return {
    purpose: 'chat-session',
    audience: String(payload.aud),
    teamId: payload.teamId,
    userId: payload.userId,
    chatId: payload.chatId,
    issuedAt: new Date(issuedAt * 1000),
    expiresAt: new Date(expiresAt * 1000),
    tokenId: payload.jti,
  }
}

function assertSecret(secret: string) {
  if (!isNonEmptyString(secret) || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new EveServiceCapabilityError('EVE_CAPABILITY_INVALID_SECRET', 'Eve capability secret must be at least 32 bytes')
  }
}
function base64UrlJson(value: unknown) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') }
function decodeJson(value: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) return decoded as Record<string, unknown>
  } catch {
    throw malformed()
  }
  throw malformed()
}
function malformed() { return new EveServiceCapabilityError('EVE_CAPABILITY_MALFORMED', 'Eve capability is malformed') }
function signature(value: string, secret: string) { return createHmac('sha256', secret).update(value).digest('base64url') }
function safeEqual(actual: string, expected: string) {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
