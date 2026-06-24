import '@tanstack/react-start/server-only'

import {auth} from './server'

export async function getSessionFromRequest(request: Request) {
  return auth.api.getSession({headers: request.headers})
}
