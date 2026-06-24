import {testUser, type TestUserInput} from '@/tests/fixtures/users'
import {createAuthUser} from './auth'

export type SeededUser = Awaited<ReturnType<typeof createAuthUser>>

export const seed = {
  user: async (overrides: Partial<TestUserInput> = {}) => {
    return createAuthUser({...testUser(), ...overrides})
  },
}
