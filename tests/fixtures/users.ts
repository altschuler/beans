export type TestUserInput = {
  name: string
  email: string
  password: string
}

export function testUser(suffix = crypto.randomUUID()): TestUserInput {
  return {
    name: `Test User ${suffix.slice(0, 8)}`,
    email: `test-${suffix}@example.com`,
    password: 'password1234',
  }
}
