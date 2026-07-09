import {createFileRoute} from '@tanstack/react-router'
import {handleEveChatProxyRequest} from '@/eve/eve-chat-proxy.server'

export const Route = createFileRoute('/api/eve/chat/$chatId')({
  server: {
    handlers: {
      POST: async ({request, params}: {request: Request; params: {chatId: string}}) => handleEveChatProxyRequest(request, params),
    },
  },
})
