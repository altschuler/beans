const MAX_AUTH_REDIRECT_LENGTH = 2048

export function resolveAuthRedirectTarget(redirect: string | undefined) {
  if (!redirect) return '/app'
  if (redirect.length > MAX_AUTH_REDIRECT_LENGTH) return '/app'
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return '/app'

  try {
    const url = new URL(redirect, 'https://app.local')
    if (url.pathname === '/login' || url.pathname.startsWith('/api/auth')) return '/app'
  } catch {
    return '/app'
  }

  return redirect
}
