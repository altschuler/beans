// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const flueMocks = vi.hoisted(() => ({
  providerProps: vi.fn(),
  createFlueClient: vi.fn((options: {baseUrl: string; fetch?: typeof fetch}) => ({kind: 'flue-client', options})),
}))

vi.mock('@flue/react', () => ({
  FlueProvider: (props: {client: unknown; children: React.ReactNode}) => {
    flueMocks.providerProps(props)
    return React.createElement('div', {'data-testid': 'flue-provider'}, props.children)
  },
}))

vi.mock('@flue/sdk', () => ({
  createFlueClient: flueMocks.createFlueClient,
}))

describe('AppFlueProvider', () => {
  it('creates a same-origin browser client by default', async () => {
    const {AppFlueProvider} = await import('@/components/flue/app-flue-provider')

    renderToStaticMarkup(React.createElement(AppFlueProvider, null, React.createElement('p', null, 'App')))

    expect(flueMocks.createFlueClient).toHaveBeenCalledWith({baseUrl: '/api/flue', fetch: expect.any(Function)})
    expect(flueMocks.providerProps).toHaveBeenCalledWith(expect.objectContaining({children: expect.anything()}))
  })

  it('passes a fetch wrapper that preserves the browser global receiver', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError('fetch called with wrong receiver')
      return Promise.resolve(new Response('{}'))
    })
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const {AppFlueProvider} = await import('@/components/flue/app-flue-provider')

      renderToStaticMarkup(React.createElement(AppFlueProvider, null, React.createElement('p', null, 'App')))
      const fetchWrapper = flueMocks.createFlueClient.mock.calls.at(-1)?.[0].fetch

      await expect(fetchWrapper?.('https://example.test')).resolves.toBeInstanceOf(Response)
      expect(fetchMock.mock.contexts[0]).toBe(globalThis)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
