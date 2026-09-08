import '@tanstack/react-start/server-only'

import {createHash} from 'node:crypto'
import {and, eq} from 'drizzle-orm'
import {z} from 'zod'
import {teamMembers, teams} from '@penge/domain/schema'
import {getSessionFromRequest} from '@/auth/session.server'
import {db} from '@/db/client'

const messageSchema = z.object({kind: z.literal('user'), body: z.string().trim().min(1).max(4000)}).strict()

export async function proxyChat(request: Request) {
  const unavailable = () => Response.json({error: {type: 'runtime_unavailable', message: 'Chat is unavailable', details: ''}}, {status: 503})
  if (!process.env.FLUE_INTERNAL_TOKEN) return unavailable()
  const session = await getSessionFromRequest(request)
  if (!session) return new Response('Unauthorized', {status: 401})

  const url = new URL(request.url)
  // Only the caller's current conversation is addressable. No caller-supplied ids,
  // signals, initialData, tools, or attachment operations cross this boundary.
  const suffix = url.pathname.slice('/api/chat/'.length)
  if (suffix !== 'current' && suffix !== 'current/abort') return new Response('Not found', {status: 404})
  if (!['GET', 'HEAD', 'POST'].includes(request.method) || (suffix.endsWith('/abort') && request.method !== 'POST')) {
    return new Response('Method not allowed', {status: 405})
  }
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return new Response('Forbidden', {status: 403})

  const [team] = await db
    .select({id: teams.id})
    .from(teams)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, session.user.id)))
    .where(eq(teams.personalOwnerUserId, session.user.id))
    .limit(1)
  if (!team) return new Response('Not found', {status: 404})
  const id = createHash('sha256')
    .update(JSON.stringify([team.id, session.user.id]))
    .digest('hex')

  let body: string | undefined
  if (request.method === 'POST' && suffix === 'current') {
    if (Number(request.headers.get('content-length')) > 16_384) return new Response('Too large', {status: 413})
    const text = await request.text()
    if (text.length > 16_384) return new Response('Too large', {status: 413})
    let parsed
    try {
      parsed = messageSchema.safeParse(JSON.parse(text))
    } catch {
      return new Response('Invalid message', {status: 400})
    }
    if (!parsed.success) return new Response('Invalid message', {status: 400})
    body = JSON.stringify(parsed.data)
  }
  const target = new URL(`http://127.0.0.1:3200/agents/assistant/${id}${suffix.endsWith('/abort') ? '/abort' : ''}`)
  target.search = url.search
  try {
    const response = await fetch(target, {
      method: request.method,
      body,
      signal: request.signal,
      headers: {
        authorization: `Bearer ${process.env.FLUE_INTERNAL_TOKEN}`,
        'content-type': 'application/json',
        accept: request.headers.get('accept') ?? 'application/json',
      },
    })
    if (response.status === 404)
      return Response.json({error: {type: 'stream_not_found', message: 'Conversation not started', details: ''}}, {status: 404})
    if (!response.ok) return unavailable()
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    headers.delete('content-length')
    if (response.status === 202) {
      const admission = await response.json()
      headers.set('location', `${url.origin}/api/chat/current`)
      return Response.json({...admission, streamUrl: `${url.origin}/api/chat/current`}, {status: 202, headers})
    }
    return new Response(response.body, {status: response.status, headers})
  } catch {
    return unavailable()
  }
}
