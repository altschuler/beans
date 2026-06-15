import type {ZeroContext} from '@/zero/context'

export function zeroContextFor(userID: string): ZeroContext {
  return {userID}
}
