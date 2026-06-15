import {createFileRoute} from '@tanstack/react-router'
import {auth} from '@/auth/server'

async function handleAuthRequest(request: Request) {
  return auth.handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({request}: {request: Request}) => handleAuthRequest(request),
      POST: async ({request}: {request: Request}) => handleAuthRequest(request),
    },
  },
})
