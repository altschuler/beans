import '@tanstack/react-start/server-only'

import type {
  GoCardlessAccountDetails,
  GoCardlessInstitution,
  GoCardlessRequisition,
  GoCardlessTransactionsResponse,
} from './types'

type Fetch = typeof fetch

type ClientOptions = {
  secretId?: string
  secretKey?: string
  baseUrl?: string
  fetchImpl?: Fetch
}

type TokenResponse = {
  access: string
  access_expires: number
}

export function createGoCardlessClient(options: ClientOptions = {}) {
  const secretId = options.secretId ?? process.env.GOCARDLESS_SECRET_ID
  const secretKey = options.secretKey ?? process.env.GOCARDLESS_SECRET_KEY
  const baseUrl = (options.baseUrl ?? 'https://bankaccountdata.gocardless.com/api/v2').replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  let cachedAccessToken: {token: string; expiresAt: number} | undefined

  if (!secretId || !secretKey) {
    throw new Error('GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY are required')
  }

  async function getAccessToken() {
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
      return cachedAccessToken.token
    }

    const path = '/token/new/'
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
      body: JSON.stringify({secret_id: secretId, secret_key: secretKey}),
    })

    if (!response.ok) {
      const detail = await responseErrorDetail(response)
      throw new Error(`GoCardless request failed: POST ${path} returned ${response.status}${detail}`)
    }

    const token = (await response.json()) as TokenResponse
    cachedAccessToken = {
      token: token.access,
      expiresAt: Date.now() + Math.max(token.access_expires - 60, 0) * 1000,
    }

    return cachedAccessToken.token
  }

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const accessToken = await getAccessToken()
    const init: RequestInit = {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body ? {'Content-Type': 'application/json'} : {}),
      },
    }

    if (method !== 'GET') {
      init.method = method
    }

    if (body) {
      init.body = JSON.stringify(body)
    }

    const response = await fetchImpl(`${baseUrl}${path}`, init)

    if (!response.ok) {
      const detail = await responseErrorDetail(response)
      throw new Error(`GoCardless request failed: ${method} ${path} returned ${response.status}${detail}`)
    }

    return response.json() as Promise<T>
  }

  return {
    listInstitutions(country = 'DK') {
      return request<GoCardlessInstitution[]>('GET', `/institutions/?country=${encodeURIComponent(country)}`)
    },
    getInstitution(institutionId: string) {
      return request<GoCardlessInstitution>('GET', `/institutions/${encodeURIComponent(institutionId)}/`)
    },
    createRequisition(input: {institutionId: string; redirectUrl: string; reference: string; accountSelection?: boolean}) {
      return request<GoCardlessRequisition>('POST', '/requisitions/', {
        institution_id: input.institutionId,
        redirect: input.redirectUrl,
        reference: input.reference,
        ...(input.accountSelection ? {account_selection: true} : {}),
      })
    },
    getRequisition(requisitionId: string) {
      return request<GoCardlessRequisition>('GET', `/requisitions/${encodeURIComponent(requisitionId)}/`)
    },
    getAccountDetails(accountId: string) {
      return request<GoCardlessAccountDetails>('GET', `/accounts/${encodeURIComponent(accountId)}/details/`)
    },
    getAccountTransactions(input: {accountId: string; dateFrom?: string}) {
      const query = input.dateFrom ? `?date_from=${encodeURIComponent(input.dateFrom)}` : ''
      return request<GoCardlessTransactionsResponse>(
        'GET',
        `/accounts/${encodeURIComponent(input.accountId)}/transactions/${query}`,
      )
    },
  }
}

async function responseErrorDetail(response: Response) {
  const body = await response.text()

  if (!body) {
    return ''
  }

  try {
    const parsed: unknown = JSON.parse(body)

    if (isGoCardlessErrorBody(parsed)) {
      return `: ${[parsed.summary, parsed.detail].filter(Boolean).join(': ')}`
    }
  } catch {
    // Fall back to the raw response body below.
  }

  return `: ${body}`
}

function isGoCardlessErrorBody(value: unknown): value is {summary?: string; detail?: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('summary' in value || 'detail' in value) &&
    (!('summary' in value) || typeof value.summary === 'string') &&
    (!('detail' in value) || typeof value.detail === 'string')
  )
}

export type GoCardlessClient = ReturnType<typeof createGoCardlessClient>
