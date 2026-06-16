import {describe, expect, it, vi} from 'vitest'
import {createGoCardlessClient} from '@/banking/gocardless/client.server'

describe('createGoCardlessClient', () => {
  it('mints an access token with GoCardless secrets before fetching Danish institutions', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({access: 'access-token-123', access_expires: 3600}), {status: 200}))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{id: 'BANK_DK', name: 'Danish Bank', countries: ['DK']}]), {status: 200}),
      )
    const client = createGoCardlessClient({
      secretId: 'secret-id-123',
      secretKey: 'secret-key-123',
      baseUrl: 'https://example.test/api/v2',
      fetchImpl,
    })

    const institutions = await client.listInstitutions('DK')

    expect(institutions).toEqual([{id: 'BANK_DK', name: 'Danish Bank', countries: ['DK']}])
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://example.test/api/v2/token/new/', {
      method: 'POST',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
      body: JSON.stringify({secret_id: 'secret-id-123', secret_key: 'secret-key-123'}),
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://example.test/api/v2/institutions/?country=DK', {
      headers: {Authorization: 'Bearer access-token-123', Accept: 'application/json'},
    })
  })

  it('reuses a cached access token while it is valid', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({access: 'access-token-123', access_expires: 3600}), {status: 200}))
      .mockImplementation(async () => new Response(JSON.stringify([]), {status: 200}))
    const client = createGoCardlessClient({
      secretId: 'secret-id-123',
      secretKey: 'secret-key-123',
      baseUrl: 'https://example.test/api/v2',
      fetchImpl,
    })

    await client.listInstitutions('DK')
    await client.listInstitutions('SE')

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl).toHaveBeenNthCalledWith(3, 'https://example.test/api/v2/institutions/?country=SE', {
      headers: {Authorization: 'Bearer access-token-123', Accept: 'application/json'},
    })
  })

  it('throws when GoCardless secrets are missing', () => {
    expect(() =>
      createGoCardlessClient({secretId: '', secretKey: '', baseUrl: 'https://example.test/api/v2', fetchImpl: vi.fn()}),
    ).toThrow('GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY are required')
  })

  it('throws response details for token endpoint failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({summary: 'Invalid credentials', detail: 'Secret key is invalid'}), {status: 401}),
    )
    const client = createGoCardlessClient({
      secretId: 'secret-id-123',
      secretKey: 'secret-key-123',
      baseUrl: 'https://example.test/api/v2',
      fetchImpl,
    })

    await expect(client.listInstitutions('DK')).rejects.toThrow(
      'GoCardless request failed: POST /token/new/ returned 401: Invalid credentials: Secret key is invalid',
    )
  })

  it('throws response details for non-2xx API responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({access: 'access-token-123', access_expires: 3600}), {status: 200}))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({summary: 'Invalid token', detail: 'Token is invalid or expired'}), {status: 401}),
      )
    const client = createGoCardlessClient({
      secretId: 'secret-id-123',
      secretKey: 'secret-key-123',
      baseUrl: 'https://example.test/api/v2',
      fetchImpl,
    })

    await expect(client.listInstitutions('DK')).rejects.toThrow(
      'GoCardless request failed: GET /institutions/?country=DK returned 401: Invalid token: Token is invalid or expired',
    )
  })
})
