import {createFileRoute} from '@tanstack/react-router'
import {proxyChat} from '@/chat/proxy.server'

export const Route = createFileRoute('/api/chat/$')({
  server: {
    handlers: {GET: ({request}) => proxyChat(request), HEAD: ({request}) => proxyChat(request), POST: ({request}) => proxyChat(request)},
  },
})
