import {describe, expect, it, vi} from 'vitest'
import {encodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'

vi.mock('@flue/runtime', () => ({
  defineAgent: vi.fn((initializer) => ({initializer})),
  defineTool: vi.fn((tool) => tool),
}))

describe('team data assistant Flue agent', () => {
  it('describes natural confirmation for transaction and category writes', async () => {
    const mod = await import('../../../../apps/flue/src/agents/team-data-assistant')

    expect(mod.description).toContain('team finance data')
    expect(mod.teamDataAssistantInstructions).toContain('concrete proposal')
    expect(mod.teamDataAssistantInstructions).toContain('natural confirmation')
    expect(mod.teamDataAssistantInstructions).toContain('initial user request')
    expect(mod.teamDataAssistantInstructions).toContain('ask an explicit permission question')
    expect(mod.teamDataAssistantInstructions).toContain('separate confirming user reply')
    expect(mod.teamDataAssistantInstructions).toContain('category or category group')
    expect(mod.teamDataAssistantInstructions).toContain('re-read')
    expect(mod.teamDataAssistantInstructions).toContain('stop remaining category-management operations')
    expect(mod.teamDataAssistantInstructions).not.toContain('cannot create, rename, edit, or delete categories')
  })

  it('exposes confirmed chat write tools instead of the autonomous suggestion tool', async () => {
    const mod = await import('../../../../apps/flue/src/agents/team-data-assistant')
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})

    const agent = mod.createTeamDataAssistantConfig({id})
    const toolsByName = Object.fromEntries(agent.tools.map(tool => [tool.name, tool]))

    expect(agent.tools.map(tool => tool.name)).toContain('applyCategorization')
    expect(agent.tools.map(tool => tool.name)).toContain('manageCategory')
    expect(agent.tools.map(tool => tool.name)).not.toContain('applyCategorizationSuggestion')
    expect(toolsByName.applyCategorization?.description).toContain('separate confirming user reply')
    expect(toolsByName.manageCategory?.description).toContain('separate confirming user reply')
  })

  it('rejects HTTP access without the internal token or matching scope headers', async () => {
    const mod = await import('../../../../apps/flue/src/agents/team-data-assistant')
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const next = vi.fn()
    process.env.PENGE_FLUE_INTERNAL_TOKEN = 'secret'

    const unauthorized = (await mod.route(fakeContext({id, authorization: 'Bearer wrong', userId: 'user-1', teamId: 'team-1'}), next)) as Response
    expect(unauthorized.status).toBe(404)
    expect(next).not.toHaveBeenCalled()

    const mismatched = (await mod.route(fakeContext({id, authorization: 'Bearer secret', userId: 'user-2', teamId: 'team-1'}), next)) as Response
    expect(mismatched.status).toBe(404)
    expect(next).not.toHaveBeenCalled()

    await mod.route(fakeContext({id, authorization: 'Bearer secret', userId: 'user-1', teamId: 'team-1'}), next)
    expect(next).toHaveBeenCalledOnce()
  })
})

function fakeContext(input: {id: string; authorization: string; userId: string; teamId: string}) {
  return {
    req: {
      header(name: string) {
        if (name.toLowerCase() === 'authorization') return input.authorization
        if (name.toLowerCase() === 'x-penge-user-id') return input.userId
        if (name.toLowerCase() === 'x-penge-team-id') return input.teamId
        return undefined
      },
      param(name: string) {
        return name === 'id' ? input.id : undefined
      },
    },
    json(body: unknown, status: number) {
      return new Response(JSON.stringify(body), {status})
    },
  } as never
}
