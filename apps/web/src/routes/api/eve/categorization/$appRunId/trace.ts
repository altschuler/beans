import {createFileRoute} from '@tanstack/react-router'
import {handleEveCategorizationTrace} from '@/ledger/eve-categorization-trace.server'

export const Route = createFileRoute('/api/eve/categorization/$appRunId/trace')({
  server: {
    handlers: {
      GET: ({request, params}: {request: Request; params: {appRunId: string}}) =>
        handleEveCategorizationTrace(request, params.appRunId),
    },
  },
})
