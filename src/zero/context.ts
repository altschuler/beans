export type ZeroContext = {
  userID: string
}

export function requireUserID(ctx: ZeroContext | undefined): string {
  if (!ctx?.userID) {
    throw new Error('Authentication required')
  }

  return ctx.userID
}

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: ZeroContext | undefined
  }
}
