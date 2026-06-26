import {createFileRoute} from '@tanstack/react-router'
import {handleFlueProxyRequest} from '@/flue/flue-proxy.server'

export const Route = createFileRoute('/api/flue/$')({
  server: {
    handlers: {
      GET: async ({request}: {request: Request}) => handleFlueProxyRequest(request),
      POST: async ({request}: {request: Request}) => handleFlueProxyRequest(request),
      HEAD: async ({request}: {request: Request}) => handleFlueProxyRequest(request),
    },
  },
})
