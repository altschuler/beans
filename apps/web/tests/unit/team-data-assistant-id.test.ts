import {describe, expect, it} from 'vitest'
import {decodeTeamDataAssistantId, encodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'

describe('team data assistant ids', () => {
  it('round-trips team and user ids through one URL path segment', () => {
    const id = encodeTeamDataAssistantId({teamId: 'team:one/with spaces', userId: 'user@example.com'})

    expect(id).toMatch(/^team-data:/)
    expect(id).not.toContain('/')
    expect(decodeTeamDataAssistantId(id)).toEqual({teamId: 'team:one/with spaces', userId: 'user@example.com'})
  })

  it('round-trips an optional chat id for fresh conversations', () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})

    expect(decodeTeamDataAssistantId(id)).toEqual({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})
  })

  it('rejects unrelated or malformed ids', () => {
    expect(decodeTeamDataAssistantId('other:abc')).toBeNull()
    expect(decodeTeamDataAssistantId('team-data:not-json')).toBeNull()
    expect(decodeTeamDataAssistantId('team-data:%7B%22teamId%22%3A%22team-1%22%7D')).toBeNull()
  })
})
