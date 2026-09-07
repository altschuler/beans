import '@testing-library/jest-dom/vitest'
import {cleanup} from '@testing-library/react'
import {afterEach, vi} from 'vitest'

afterEach(() => {
  cleanup()
})

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => false)
  window.HTMLElement.prototype.releasePointerCapture ??= vi.fn()
  window.HTMLElement.prototype.setPointerCapture ??= vi.fn()

  window.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver ??= window.ResizeObserver
}
