import '@tanstack/react-start/server-only'

import {mintEveServiceCapability} from '@penge/domain/eve-service-capability'

export function mintEveChatSessionCapability(
  scope: {teamId: string; userId: string; chatId: string},
  options: {now?: Date} = {},
) {
  const secret = process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET
  if (!secret) throw new Error('PENGE_EVE_SERVICE_CAPABILITY_SECRET is required')
  return mintEveServiceCapability({purpose: 'chat-session', ...scope}, {secret, now: options.now})
}
