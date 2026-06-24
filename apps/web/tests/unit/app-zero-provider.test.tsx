// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {render} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const zeroReactMocks = vi.hoisted(() => {
  const preload = vi.fn()
  return {
    preload,
    zero: {preload},
    zeroProviderProps: vi.fn(),
  }
})

const coreQueryMocks = vi.hoisted(() => ({
  teams: {name: 'teams', preload: vi.fn()},
  bankAccounts: {name: 'bankAccounts', preload: vi.fn()},
  bankTransactions: {name: 'bankTransactions', preload: vi.fn()},
  ledgerAccountGroups: {name: 'ledgerAccountGroups', preload: vi.fn()},
  ledgerAccounts: {name: 'ledgerAccounts', preload: vi.fn()},
  ledgerTransactions: {name: 'ledgerTransactions', preload: vi.fn()},
  ledgerPostings: {name: 'ledgerPostings', preload: vi.fn()},
}))

vi.mock('@rocicorp/zero/react', () => ({
  ZeroProvider: (props: Record<string, unknown> & {children: React.ReactNode}) => {
    zeroReactMocks.zeroProviderProps(props)
    return React.createElement('div', {'data-testid': 'zero-provider'}, props.children)
  },
  useZero: () => zeroReactMocks.zero,
}))

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      teams: () => coreQueryMocks.teams,
      bankAccounts: () => coreQueryMocks.bankAccounts,
      bankTransactions: () => coreQueryMocks.bankTransactions,
      ledgerAccountGroups: () => coreQueryMocks.ledgerAccountGroups,
      ledgerAccounts: () => coreQueryMocks.ledgerAccounts,
      ledgerTransactions: () => coreQueryMocks.ledgerTransactions,
      ledgerPostings: () => coreQueryMocks.ledgerPostings,
    },
  },
}))

const coreQueryNames = [
  'teams',
  'bankAccounts',
  'bankTransactions',
  'ledgerAccountGroups',
  'ledgerAccounts',
  'ledgerTransactions',
  'ledgerPostings',
] as const

beforeEach(() => {
  zeroReactMocks.preload.mockReset()
  zeroReactMocks.zeroProviderProps.mockReset()
  for (const query of Object.values(coreQueryMocks)) {
    query.preload.mockReset()
  }
})

describe('AppZeroProvider', () => {
  it('partitions storage by userID and lets Zero derive schema hashes from the generated schema', async () => {
    const {AppZeroProvider} = await import('@/components/zero/app-zero-provider')

    renderToStaticMarkup(React.createElement(AppZeroProvider, {userID: 'user-1', children: React.createElement('p', null, 'App')}))

    expect(zeroReactMocks.zeroProviderProps).toHaveBeenCalledWith(expect.objectContaining({userID: 'user-1'}))
    // No storageKey: Zero already partitions client storage by userID, so an extra
    // discriminator is unnecessary for our single app-wide instance.
    expect(zeroReactMocks.zeroProviderProps.mock.calls[0]?.[0]).not.toHaveProperty('storageKey')
    expect(zeroReactMocks.zeroProviderProps.mock.calls[0]?.[0]).not.toHaveProperty('schemaVersion')
  })

  it('preloads core team-scoped queries with an explicit ttl and cleans them up on unmount', async () => {
    const {AppZeroProvider} = await import('@/components/zero/app-zero-provider')
    const cleanupByQueryName = new Map<string, ReturnType<typeof vi.fn>>()

    zeroReactMocks.preload.mockImplementation((query: (typeof coreQueryMocks)[(typeof coreQueryNames)[number]]) => {
      const cleanup = vi.fn()
      cleanupByQueryName.set(query.name, cleanup)
      return {complete: Promise.resolve(), cleanup}
    })

    const {unmount} = render(
      React.createElement(AppZeroProvider, {userID: 'user-1', children: React.createElement('p', null, 'App')}),
    )

    expect(zeroReactMocks.preload).toHaveBeenCalledTimes(coreQueryNames.length)
    for (const queryName of coreQueryNames) {
      expect(zeroReactMocks.preload).toHaveBeenCalledWith(coreQueryMocks[queryName], {ttl: '30m'})
      expect(coreQueryMocks[queryName].preload).not.toHaveBeenCalled()
    }

    unmount()

    for (const queryName of coreQueryNames) {
      expect(cleanupByQueryName.get(queryName)).toHaveBeenCalledOnce()
    }
  })
})
