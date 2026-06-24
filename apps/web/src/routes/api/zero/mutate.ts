import {createFileRoute} from '@tanstack/react-router'
import {mustGetMutator} from '@rocicorp/zero'
import {handleMutateRequest} from '@rocicorp/zero/server'
import {getSessionFromRequest} from '@/auth/session.server'
import {dbProvider} from '@/db/zero-provider'
import {serverMutators} from '@/zero/mutators.server'
import type {ZeroContext} from '@/zero/context'

function dispatchServerMutator<TTx, TArgs>(name: string, input: {args: TArgs; tx: TTx; ctx: ZeroContext}) {
  // Zero dispatches mutate requests by runtime name/JSON args; the server adapter does not expose
  // a typed overload at this boundary, so keep the narrow cast isolated here.
  const mutator = mustGetMutator(serverMutators, name) as {
    fn: (input: {args: TArgs; tx: TTx; ctx: ZeroContext}) => Promise<void>
  }
  return mutator.fn(input)
}

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
          handler: transact => transact((tx, name, args) => dispatchServerMutator(name, {args, tx, ctx})),
          request,
          userID: session.user.id,
        })

        return Response.json(result)
      },
    },
  },
})
