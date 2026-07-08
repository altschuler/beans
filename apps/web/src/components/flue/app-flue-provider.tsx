import {useMemo, type ReactNode} from 'react'
import {FlueProvider} from '@flue/react'
import {createFlueClient} from '@flue/sdk'
import {getLatestTeamChatClientContext} from '@/components/flue/team-chat-ui-context'

function resolveFlueBaseUrl() {
  if (typeof window !== 'undefined') return '/api/flue'
  return `${process.env.VITE_PUBLIC_APP_URL ?? 'https://localhost:3100'}/api/flue`
}

export function AppFlueProvider({children}: {children: ReactNode}) {
  const client = useMemo(() => createFlueClient({baseUrl: resolveFlueBaseUrl(), fetch: teamChatContextFetch}), [])
  return <FlueProvider client={client}>{children}</FlueProvider>
}

async function teamChatContextFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, await withTeamChatContext(input, init))
}

async function withTeamChatContext(input: RequestInfo | URL, init?: RequestInit): Promise<RequestInit | undefined> {
  if (!isTeamDataAssistantPromptRequest(input, init)) return init

  const bodyText = await requestBodyText(init?.body)
  if (!bodyText) return init

  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return init
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return init

  return {
    ...init,
    headers: withoutContentLength(init?.headers),
    body: JSON.stringify({...body, context: getLatestTeamChatClientContext()}),
  }
}

function isTeamDataAssistantPromptRequest(input: RequestInfo | URL, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? (input instanceof Request ? input.method.toUpperCase() : 'GET')
  if (method !== 'POST') return false
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  return /\/agents\/team-data-assistant\/[^/?#]+(?:\?|$)/.test(url) && !/\/abort(?:\?|$)/.test(url) && !/\/attachments\//.test(url)
}

async function requestBodyText(body: BodyInit | null | undefined) {
  if (body == null) return null
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  return null
}

function withoutContentLength(headers: HeadersInit | undefined) {
  const next = new Headers(headers)
  next.delete('content-length')
  return next
}
