import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

vi.mock('sonner', () => ({
  Toaster: ({className, toastOptions, ...props}: {className?: string; toastOptions?: {classNames?: {toast?: string}}; richColors?: boolean}) =>
    React.createElement('div', {
      'data-class-name': className,
      'data-rich-colors': String(props.richColors),
      'data-toast-class': toastOptions?.classNames?.toast ?? '',
    }),
}))

import {Toaster} from '@/components/ui/sonner'

describe('Toaster', () => {
  it('wraps sonner with shadcn-style defaults', () => {
    const markup = renderToStaticMarkup(React.createElement(Toaster))

    expect(markup).toContain('data-class-name="toaster group"')
    expect(markup).toContain('data-rich-colors="true"')
    expect(markup).toContain('group-[.toaster]:bg-background')
  })
})
