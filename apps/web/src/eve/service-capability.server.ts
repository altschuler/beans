import '@tanstack/react-start/server-only'

import {mintEveServiceCapability} from '@penge/domain/eve-service-capability'

type ClockOptions = {
  now?: Date
}

type ChatSessionScope = {
  teamId: string
  userId: string
  chatId: string
}

type CategorizationTaskScope = {
  teamId: string
  userId: string
  appRunId: string
  targetBankTransactionIds?: string[]
}

export function mintEveChatSessionCapability(scope: ChatSessionScope, options: ClockOptions = {}) {
  return mintEveServiceCapability({purpose: 'chat-session', ...scope}, {secret: getEveServiceCapabilitySecret(), now: options.now})
}

export function mintEveCategorizationTaskCapability(scope: CategorizationTaskScope, options: ClockOptions = {}) {
  return mintEveServiceCapability({purpose: 'categorization-task', ...scope}, {secret: getEveServiceCapabilitySecret(), now: options.now})
}

export function mintEveCategorizationTraceCapability(
  scope: {teamId: string; userId: string; appRunId: string; eveSessionId: string},
  options: ClockOptions = {},
) {
  return mintEveServiceCapability({purpose: 'categorization-trace', ...scope}, {secret: getEveServiceCapabilitySecret(), now: options.now})
}

function getEveServiceCapabilitySecret() {
  const secret = process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET
  if (!secret) throw new Error('PENGE_EVE_SERVICE_CAPABILITY_SECRET is required')
  return secret
}
