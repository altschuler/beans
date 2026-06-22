import {beforeEach, describe, expect, it, vi} from 'vitest'

// The Zero query/mutate routes are the trust boundary: they must reject
// unauthenticated requests and derive `userID` from the server-verified session
// rather than anything the client supplies. We isolate the route handler by
// mocking the Zero plumbing so these tests exercise only the auth gate and the
// `userID`/`ctx` propagation.

const getSessionFromRequest = vi.fn()
const handleQueryRequest = vi.fn()
const handleMutateRequest = vi.fn()
const mustGetQuery = vi.fn()
const mustGetMutator = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({options}),
}))
vi.mock('@/auth/session.server', () => ({getSessionFromRequest}))
vi.mock('@rocicorp/zero/server', () => ({handleQueryRequest, handleMutateRequest}))
vi.mock('@rocicorp/zero', () => ({mustGetQuery, mustGetMutator}))
vi.mock('@/zero/queries', () => ({queries: {}}))
vi.mock('@/zero/schema', () => ({schema: {}}))
vi.mock('@/db/zero-provider', () => ({dbProvider: {}}))
vi.mock('@/zero/mutators.server', () => ({serverMutators: {}}))

type PostHandler = (ctx: {request: Request}) => Promise<Response>
type QueryDispatch = (name: string, args: unknown) => unknown
type Transact = (cb: (tx: unknown, name: string, args: unknown) => Promise<void>) => unknown

async function loadHandler(modulePath: string): Promise<PostHandler> {
  const mod = (await import(modulePath)) as {Route: {options: {server: {handlers: {POST: PostHandler}}}}}
  return mod.Route.options.server.handlers.POST
}

// Body claims a different user; the endpoints must never trust client-supplied identity.
function postRequest(body: unknown = {userID: 'attacker'}) {
  return new Request('https://app.test/api/zero', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {'content-type': 'application/json'},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Zero query endpoint auth', () => {
  it('returns 401 for unauthenticated requests without invoking the query handler', async () => {
    getSessionFromRequest.mockResolvedValue(null)
    const POST = await loadHandler('@/routes/api/zero/query')

    const response = await POST({request: postRequest()})

    expect(response.status).toBe(401)
    expect(handleQueryRequest).not.toHaveBeenCalled()
  })

  it('derives userID from the session and threads it into the query ctx', async () => {
    getSessionFromRequest.mockResolvedValue({user: {id: 'user-1'}})
    const queryFn = vi.fn(() => 'rows')
    mustGetQuery.mockReturnValue({fn: queryFn})
    handleQueryRequest.mockImplementation(async (opts: {handler: QueryDispatch; userID: string}) => {
      opts.handler('teams', {}) // drive the per-query handler to observe the ctx it builds
      return {userID: opts.userID}
    })
    const POST = await loadHandler('@/routes/api/zero/query')

    const response = await POST({request: postRequest()})

    expect(response.status).toBe(200)
    expect(handleQueryRequest).toHaveBeenCalledWith(expect.objectContaining({userID: 'user-1'}))
    expect(queryFn).toHaveBeenCalledWith(expect.objectContaining({ctx: {userID: 'user-1'}}))
  })
})

describe('Zero mutate endpoint auth', () => {
  it('returns 401 for unauthenticated requests without invoking the mutate handler', async () => {
    getSessionFromRequest.mockResolvedValue(null)
    const POST = await loadHandler('@/routes/api/zero/mutate')

    const response = await POST({request: postRequest()})

    expect(response.status).toBe(401)
    expect(handleMutateRequest).not.toHaveBeenCalled()
  })

  it('derives userID from the session and threads it into the mutator ctx', async () => {
    getSessionFromRequest.mockResolvedValue({user: {id: 'user-1'}})
    const mutatorFn = vi.fn(async () => {})
    mustGetMutator.mockReturnValue({fn: mutatorFn})
    handleMutateRequest.mockImplementation(async (opts: {handler: (t: Transact) => Promise<unknown>; userID: string}) => {
      await opts.handler(cb => cb({}, 'categorize', {})) // drive the transact path to the mutator
      return {userID: opts.userID}
    })
    const POST = await loadHandler('@/routes/api/zero/mutate')

    const response = await POST({request: postRequest()})

    expect(response.status).toBe(200)
    expect(handleMutateRequest).toHaveBeenCalledWith(expect.objectContaining({userID: 'user-1'}))
    expect(mutatorFn).toHaveBeenCalledWith(expect.objectContaining({ctx: {userID: 'user-1'}}))
  })
})
