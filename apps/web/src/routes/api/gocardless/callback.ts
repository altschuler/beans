import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/api/gocardless/callback')({
  server: {
    handlers: {
      GET: async ({request}: {request: Request}) => {
        const url = new URL(request.url)
        const reference = url.searchParams.get('ref')
        const teamId = url.searchParams.get('teamId')
        const appUrl = process.env.VITE_PUBLIC_APP_URL ?? 'https://localhost:3000'

        if (!reference || !teamId) {
          return Response.redirect(`${appUrl}/app?bankLink=missing-params`, 302)
        }

        const {getSessionFromRequest} = await import('@/auth/session.server')
        const session = await getSessionFromRequest(request)

        if (!session) {
          return Response.redirect(`${appUrl}/login?redirect=${encodeURIComponent('/app')}`, 302)
        }

        try {
          const {completeGoCardlessCallback} = await import('@/banking/callback.server')
          await completeGoCardlessCallback({reference, teamId, userId: session.user.id})
          return Response.redirect(`${appUrl}/app?bankLink=linked`, 302)
        } catch {
          return Response.redirect(`${appUrl}/app?bankLink=failed`, 302)
        }
      },
    },
  },
})
