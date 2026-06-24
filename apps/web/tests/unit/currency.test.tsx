import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it} from 'vitest'
import {Currency} from '@/components/currency'

describe('Currency', () => {
  it('renders canonical scaled amounts with a currency code', () => {
    const markup = renderToStaticMarkup(<Currency amount={-1_000_000} currency="DKK" />)

    expect(markup).toContain('-100.00 DKK')
  })

  it('does not hide scale-4 precision', () => {
    const markup = renderToStaticMarkup(<Currency amount={1} currency="DKK" />)

    expect(markup).toContain('0.0001 DKK')
  })

  it('supports caller-owned layout classes', () => {
    const markup = renderToStaticMarkup(<Currency amount={702_500} currency="DKK" className="font-mono text-right" />)

    expect(markup).toContain('class="font-mono text-right"')
    expect(markup).toContain('70.25 DKK')
  })
})
