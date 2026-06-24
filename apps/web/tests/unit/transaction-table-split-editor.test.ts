import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {SplitEditor} from '@/components/transaction-table/split-editor'
import {testCategorizationAccounts} from '../helpers/transaction-table'

describe('SplitEditor', () => {
  it('renders compact split controls with accessible names', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SplitEditor, {
        splitLines: [
          {accountId: 'groceries', amount: '60.00'},
          {accountId: 'household', amount: '40.00'},
        ],
        setSplitLines: vi.fn(),
        categorizationAccounts: testCategorizationAccounts,
        transactionAmount: -1_000_000,
        currency: 'DKK',
        onBack: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
      }),
    )

    expect(markup).toContain('Split transaction')
    expect(markup).toContain('aria-label="Back to categories"')
    expect(markup).toContain('aria-label="Add split line"')
    expect(markup).toContain('aria-label="Fill remaining amount for split line 1"')
    expect(markup).toContain('aria-label="Remove split line 1"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Save split')
  })
})
