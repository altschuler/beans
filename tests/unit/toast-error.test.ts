import {beforeEach, describe, expect, it, vi} from 'vitest'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}))

import {showErrorToast} from '@/lib/show-error-toast'

describe('showErrorToast', () => {
  beforeEach(() => {
    toastError.mockClear()
  })

  it('shows error messages in a toast', () => {
    showErrorToast(new Error('Could not save category'), 'Fallback message')

    expect(toastError).toHaveBeenCalledWith('Could not save category')
  })

  it('uses the fallback message for unknown errors', () => {
    showErrorToast('unexpected', 'Fallback message')

    expect(toastError).toHaveBeenCalledWith('Fallback message')
  })
})
