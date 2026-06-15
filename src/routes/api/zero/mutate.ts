import {createFileRoute} from '@tanstack/react-router'
import {mustGetMutator} from '@rocicorp/zero'
import {handleMutateRequest} from '@rocicorp/zero/server'
import {getSessionFromRequest} from '@/auth/session.server'
import {dbProvider} from '@/db/zero-provider'
import {mutators} from '@/zero/mutators'
import type {ZeroContext} from '@/zero/context'

export const Route = createFileRoute('/api/zero/mutate')({
  server: {
    handlers: {
      POST: async ({request}: {request: Request}) => {
        const session = await getSessionFromRequest(request)

        if (!session) {
          return new Response('Unauthorized', {status: 401})
        }

        const ctx: ZeroContext = {userID: session.user.id}
        const result = await handleMutateRequest({
          dbProvider,
          handler: transact =>
            transact((tx, name, args) => {
              const mutator = mustGetMutator(mutators, name)
              return mutator.fn({args, tx, ctx})
            }),
          request,
          userID: session.user.id,
        })

        return Response.json(result)
      },
    },
  },
})
