import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it} from 'vitest'
import {AccountHistoryChart} from '@/components/ledger/account-history-chart'

describe('AccountHistoryChart', () => {
  it('renders an empty state when there are no points', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AccountHistoryChart, {
        title: 'Spending history',
        description: 'Actual bank spending',
        type: 'bar',
        points: [],
        emptyMessage: 'No categorized bank spending yet.',
      }),
    )

    expect(markup).toContain('Spending history')
    expect(markup).toContain('No categorized bank spending yet.')
    expect(markup).not.toContain('<svg')
  })

  it('renders bar chart points with period labels', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AccountHistoryChart, {
        title: 'Money added/removed',
        description: 'Envelope activity',
        type: 'bar',
        points: [
          {key: '2026-03', label: 'Mar 2026', value: 225},
          {key: '2026-04', label: 'Apr 2026', value: -75},
        ],
        emptyMessage: 'No envelope activity yet.',
      }),
    )

    expect(markup).toContain('Money added/removed')
    expect(markup).toContain('Mar 2026')
    expect(markup).toContain('Apr 2026')
    expect(markup).toContain('225.00')
    expect(markup).toContain('-75.00')
    expect(markup).toContain('<svg')
  })

  it('renders line chart points', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AccountHistoryChart, {
        title: 'Bank balance history',
        description: 'Imported movement',
        type: 'line',
        points: [
          {key: '2026-03', label: 'Mar 2026', value: 370},
          {key: '2026-04', label: 'Apr 2026', value: 450},
        ],
        emptyMessage: 'No imported bank transactions yet.',
      }),
    )

    expect(markup).toContain('Bank balance history')
    expect(markup).toContain('<polyline')
    expect(markup).toContain('450.00')
  })
})
