import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const zeroProviderProps = vi.hoisted(() => vi.fn())

vi.mock('@rocicorp/zero/react', () => ({
  ZeroProvider: (props: Record<string, unknown> & {children: React.ReactNode}) => {
    zeroProviderProps(props)
    return React.createElement('div', {'data-testid': 'zero-provider'}, props.children)
  },
}))

describe('AppZeroProvider', () => {
  it('keeps the stable app storage key and lets Zero derive schema hashes from the generated schema', async () => {
    const {AppZeroProvider} = await import('@/components/zero/app-zero-provider')

    renderToStaticMarkup(React.createElement(AppZeroProvider, {userID: 'user-1', children: React.createElement('p', null, 'App')}))

    expect(zeroProviderProps).toHaveBeenCalledWith(expect.objectContaining({storageKey: 'penge'}))
    expect(zeroProviderProps.mock.calls[0]?.[0]).not.toHaveProperty('schemaVersion')
  })
})
