import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {teamMembers, teams, user} from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {proxyChat} from '@/chat/proxy.server'

const identity = vi.hoisted(() => ({id: 'alice' as string | null}))
vi.mock('@/auth/session.server', () => ({getSessionFromRequest: async () => (identity.id ? {user: {id: identity.id}} : null)}))

beforeAll(migrateDatabase)
afterAll(closeDatabase)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
beforeEach(async () => {
  await resetDatabase()
  identity.id = 'alice'
  vi.stubEnv('FLUE_MOCK', '1')
  vi.stubEnv('FLUE_INTERNAL_TOKEN', 'test-internal-only')
  const now = new Date()
  for (const id of ['alice', 'bob']) {
    await db.insert(user).values({id, name: id, email: `${id}@example.test`, emailVerified: true, createdAt: now, updatedAt: now})
    await db.insert(teams).values({id: `${id}-team`, name: id, personalOwnerUserId: id, createdAt: now, updatedAt: now})
    await db.insert(teamMembers).values({id, teamId: `${id}-team`, userId: id, role: 'owner', createdAt: now, updatedAt: now})
  }
})

function request(path = 'current', method = 'GET', body?: unknown, origin = 'https://app.test') {
  return new Request(`https://app.test/api/chat/${path}`, {
    method,
    headers: {origin},
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

it('isolates histories by authenticated user and persisted personal-team membership on every operation', async () => {
  const histories = new Map<string, string>()
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    if (init.method === 'POST') histories.set(url.pathname, String(init.body))
    return Response.json({history: histories.get(url.pathname) ?? ''})
  })
  await proxyChat(request('current', 'POST', {kind: 'user', body: 'Alice private message'}))
  identity.id = 'bob'
  expect(await (await proxyChat(request())).json()).toEqual({history: ''})
  expect((await proxyChat(request('alice-team'))).status).toBe(404)
  identity.id = 'alice'
  expect(await (await proxyChat(request())).text()).toContain('Alice private message')
  await db.delete(teamMembers).where(eq(teamMembers.userId, 'alice'))
  for (const [path, method] of [
    ['current', 'GET'],
    ['current?view=updates&offset=-1', 'GET'],
    ['current', 'HEAD'],
    ['current', 'POST'],
    ['current/abort', 'POST'],
  ]) {
    expect((await proxyChat(request(path, method))).status).toBe(404)
  }
  identity.id = null
  expect((await proxyChat(request())).status).toBe(401)
})

it('rejects authority injection and cross-origin writes; hides runtime errors and fails closed in production', async () => {
  const upstream = vi.fn(async () => new Response('private path and credential', {status: 500}))
  vi.stubGlobal('fetch', upstream)
  for (const body of [
    {kind: 'signal', body: 'x'},
    {kind: 'user', body: 'x', initialData: {userId: 'bob'}},
    {kind: 'user', body: 'x', uid: 'other'},
    {kind: 'user', body: 'x', attachments: []},
  ]) {
    expect((await proxyChat(request('current', 'POST', body))).status).toBe(400)
  }
  expect((await proxyChat(request('current', 'POST', {kind: 'user', body: 'x'}, 'https://stranger.test'))).status).toBe(403)
  expect((await proxyChat(request('current/attachments/private'))).status).toBe(404)
  expect(upstream).not.toHaveBeenCalled()
  const response = await proxyChat(request())
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private')
  vi.stubEnv('NODE_ENV', 'production')
  expect((await proxyChat(request())).status).toBe(503)
  expect(upstream).toHaveBeenCalledTimes(1)
})
