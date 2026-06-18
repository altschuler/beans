import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to}: {children: React.ReactNode; to: string}) => React.createElement('a', {href: to}, children),
  useRouter: () => ({navigate: vi.fn()}),
}))

vi.mock('@/auth/client', () => ({authClient: {signOut: vi.fn()}}))

import {Shell} from '@/components/layout/shell'

describe('Shell', () => {
  it('shows app navigation and product title', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        children: React.createElement('p', null, 'Content'),
      }),
    )

    expect(markup).toContain('Penge')
    expect(markup).toContain('Envelope ledger')
    expect(markup).toContain('Dashboard')
    expect(markup).toContain('Banks')
    expect(markup).not.toContain('Budgeting boilerplate')
  })
})
