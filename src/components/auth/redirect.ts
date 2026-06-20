export function resolveAuthRedirectTarget(redirect: string | undefined) {
  if (!redirect) return '/app'
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return '/app'
  return redirect
}
