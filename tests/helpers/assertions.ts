import {expect} from 'vitest'

export function expectOwnedBy(row: {userId: string}, userID: string) {
  expect(row.userId).toBe(userID)
}
