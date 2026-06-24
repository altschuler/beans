import {describe, expect, it} from 'vitest'
import {requireUserID} from '@/zero/context'
import {zeroContextFor} from '@/tests/helpers/zero'

describe('requireUserID', () => {
  it('returns the authenticated user id', () => {
    expect(requireUserID(zeroContextFor('user-123'))).toBe('user-123')
  })

  it('rejects missing auth context', () => {
    expect(() => requireUserID(undefined)).toThrow('Authentication required')
  })
})
