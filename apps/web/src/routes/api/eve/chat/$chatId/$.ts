import {createFileRoute} from '@tanstack/react-router'
import {handleEveChatProxyRequest} from '@/eve/eve-chat-proxy.server'

const handle = ({request, params}: {request: Request; params: {chatId: string}}) =>
  handleEveChatProxyRequest(request, params)

export const Route = createFileRoute('/api/eve/chat/$chatId/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
      OPTIONS: handle,
      HEAD: handle,
    },
  },
})
