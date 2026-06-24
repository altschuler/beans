import {createFileRoute} from '@tanstack/react-router'
import {mustGetQuery} from '@rocicorp/zero'
import {handleQueryRequest} from '@rocicorp/zero/server'
import {getSessionFromRequest} from '@/auth/session.server'
import {queries} from '@/zero/queries'
import {schema} from '@/zero/schema'
import type {ZeroContext} from '@/zero/context'

export const Route = createFileRoute('/api/zero/query')({
  server: {
    handlers: {
      POST: async ({request}: {request: Request}) => {
        const session = await getSessionFromRequest(request)

        if (!session) {
          return new Response('Unauthorized', {status: 401})
        }

        const ctx: ZeroContext = {userID: session.user.id}
        const result = await handleQueryRequest({
          handler: (name, args) => {
            const query = mustGetQuery(queries, name)
            return query.fn({args, ctx})
          },
          schema,
          request,
          userID: session.user.id,
        })

        return Response.json(result)
      },
    },
  },
})
