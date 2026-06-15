import {db} from '@/db/client'
import {items} from '@/db/schema'
import {testUser, type TestUserInput} from '@/tests/fixtures/users'
import {createAuthUser} from './auth'

export type SeededUser = Awaited<ReturnType<typeof createAuthUser>>

export const seed = {
  user: async (overrides: Partial<TestUserInput> = {}) => {
    return createAuthUser({...testUser(), ...overrides})
  },
  item: async ({userId, title = 'Seeded item'}: {userId: string; title?: string}) => {
    const now = new Date().toISOString()
    const [item] = await db
      .insert(items)
      .values({
        id: crypto.randomUUID(),
        userId,
        title,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return item
  },
}
