import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to}: {children: React.ReactNode; to: string}) => React.createElement('a', {href: to}, children),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: (props: React.ComponentProps<'button'>) =>
    React.createElement('button', {'aria-label': props['aria-label'], 'data-slot': 'sidebar-trigger'}, 'Toggle sidebar'),
}))

vi.mock('@/components/flue/team-chat-sidebar', () => ({
  TeamChatSidebarTrigger: () => React.createElement('button', {type: 'button', 'aria-label': 'Ask Penge', 'data-testid': 'team-chat-sidebar-trigger'}),
}))

import {PageLayout} from '@/components/page-layout'

describe('PageLayout', () => {
  it('does not apply default content padding so pages control their own spacing', () => {
    const markup = renderToStaticMarkup(React.createElement(PageLayout, {breadcrumbs: [{title: 'Home'}]}, React.createElement('p', null, 'Page content')))

    expect(markup).toMatch(/data-slot="page-layout-content"[\s\S]*class="min-h-0 flex-1 overflow-auto"/)
    expect(markup).not.toContain('p-4 md:p-6 lg:p-8')
  })

  it('renders breadcrumbs, linked ancestors, actions, and scrollable content below a fixed header', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        PageLayout,
        {
          breadcrumbs: [{title: 'Categories', to: '/app/categories'}, {title: 'Groceries'}],
          actions: React.createElement('button', {type: 'button'}, 'Save'),
          contentClassName: 'p-0',
        },
        React.createElement('p', null, 'Page content'),
      ),
    )

    expect(markup).toContain('data-slot="page-layout"')
    expect(markup).toContain('data-slot="page-layout-header"')
    expect(markup).toContain('data-slot="page-layout-actions"')
    expect(markup).toContain('data-testid="team-chat-sidebar-trigger"')
    expect(markup).toContain('data-slot="page-layout-content"')
    expect(markup).toContain('aria-label="breadcrumb"')
    expect(markup).toContain('href="/app/categories"')
    expect(markup).toContain('Categories')
    expect(markup).toContain('Groceries')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('Save')
    expect(markup.indexOf('Save')).toBeLessThan(markup.indexOf('data-testid="team-chat-sidebar-trigger"'))
    expect(markup).toContain('Page content')
    expect(markup).toMatch(/data-slot="page-layout-header"[\s\S]*class="[^"]*shrink-0/)
    expect(markup).toMatch(/data-slot="page-layout-content"[\s\S]*class="[^"]*min-h-0[^"]*flex-1[^"]*overflow-auto[^"]*p-0/)
  })
})
