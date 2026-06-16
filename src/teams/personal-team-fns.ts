import {createServerFn} from '@tanstack/react-start'

export const ensureCurrentUserPersonalTeam = createServerFn({method: 'POST'}).handler(async () => {
  const {ensureCurrentUserPersonalTeamServer} = await import('./personal-team.server')
  return ensureCurrentUserPersonalTeamServer()
})
