import {eveChannel} from 'eve/channels/eve'
import {ForbiddenError, type AuthFn} from 'eve/channels/auth'
import {eveServiceCapabilityAuth} from '../lib/service-capability-auth'

const chatSessionAuth: AuthFn<Request> = async request => {
  const auth = await eveServiceCapabilityAuth(request)
  if (!auth) return auth
  if (!isAllowedProxyRoute(request)) {
    throw new ForbiddenError({message: 'Eve route is not available to chat capabilities'})
  }
  return auth
}

export default eveChannel({
  auth: chatSessionAuth,
  uploadPolicy: 'disabled',
})

function isAllowedProxyRoute(request: Request) {
  const url = new URL(request.url)
  if (request.method === 'POST' && url.search === '') {
    return url.pathname === '/eve/v1/session' ||
      /^\/eve\/v1\/session\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)
  }
  if (request.method !== 'GET' || !/^\/eve\/v1\/session\/[A-Za-z0-9_-]{1,200}\/stream$/.test(url.pathname)) {
    return false
  }
  if (url.search === '') return true
  const query = /^\?startIndex=(0|[1-9]\d*)$/.exec(url.search)
  return Boolean(query?.[1] && Number.isSafeInteger(Number(query[1])))
}
