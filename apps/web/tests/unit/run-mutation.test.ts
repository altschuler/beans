import {beforeEach, describe, expect, it, vi} from 'vitest'

const showErrorToast = vi.hoisted(() => vi.fn())
vi.mock('@/lib/show-error-toast', () => ({showErrorToast}))

import {runZeroMutation} from '@/lib/run-mutation'

describe('runZeroMutation', () => {
  beforeEach(() => {
    showErrorToast.mockClear()
  })

  it('returns true and shows no toast when the server resolves successfully', async () => {
    const result = await runZeroMutation({server: Promise.resolve({type: 'success'})}, 'fallback')

    expect(result).toBe(true)
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('shows the app error message when the server resolves with an app error', async () => {
    const result = await runZeroMutation({server: Promise.resolve({type: 'error', error: {type: 'app', message: 'Not allowed'}})}, 'fallback')

    expect(result).toBe(false)
    expect(showErrorToast).toHaveBeenCalledOnce()
    expect((showErrorToast.mock.calls[0]?.[0] as Error).message).toBe('Not allowed')
    expect(showErrorToast.mock.calls[0]?.[1]).toBe('fallback')
  })

  it('falls back to the provided message for infra (zero) errors', async () => {
    const result = await runZeroMutation({server: Promise.resolve({type: 'error', error: {type: 'zero', message: 'connection lost'}})}, 'fallback')

    expect(result).toBe(false)
    // No Error instance is passed for zero errors, so showErrorToast uses the fallback message.
    expect(showErrorToast.mock.calls[0]?.[0]).toBeUndefined()
    expect(showErrorToast.mock.calls[0]?.[1]).toBe('fallback')
  })

  it('handles a rejected server promise defensively', async () => {
    const error = new Error('boom')
    const result = await runZeroMutation({server: Promise.reject(error)}, 'fallback')

    expect(result).toBe(false)
    expect(showErrorToast).toHaveBeenCalledWith(error, 'fallback')
  })

  it('supports a plain promise result', async () => {
    const result = await runZeroMutation(Promise.resolve({type: 'success'}), 'fallback')

    expect(result).toBe(true)
    expect(showErrorToast).not.toHaveBeenCalled()
  })
})
