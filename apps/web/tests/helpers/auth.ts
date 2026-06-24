import {auth} from '@/auth/server'
import type {TestUserInput} from '@/tests/fixtures/users'

export async function createAuthUser(input: TestUserInput) {
  const result = await auth.api.signUpEmail({
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
    },
  })

  if (!result?.user) {
    throw new Error(`Failed to create test user ${input.email}`)
  }

  return {
    ...input,
    id: result.user.id,
  }
}
