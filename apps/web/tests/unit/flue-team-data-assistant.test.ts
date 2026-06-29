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
    expect(mod.teamDataAssistantInstructions).toContain('Interactive bulk categorization mode')
    expect(mod.teamDataAssistantInstructions).toContain('explicitly asks for bulk, backlog, or initial categorization')
    expect(mod.teamDataAssistantInstructions).toContain('50 or more eligible transactions')
    expect(mod.teamDataAssistantInstructions).toContain('/work/bulk-categorization/eligible-transactions.jsonl')
    expect(mod.teamDataAssistantInstructions).toContain('/work/bulk-categorization/category-decisions.jsonl')
    expect(mod.teamDataAssistantInstructions).toContain('Do not treat the initial bulk categorization request as permission to write')
    expect(mod.teamDataAssistantInstructions).toContain('applyCategorizations')
    expect(mod.teamDataAssistantInstructions).toContain('verify remaining eligible transactions before saying the group or run is done')
    expect(mod.teamDataAssistantInstructions).toContain('Do not create durable merchant/category rules')
    expect(mod.teamDataAssistantInstructions).toContain('Report progress in chat')
  })

  it('exposes confirmed chat write tools instead of the autonomous suggestion tool', async () => {
    const mod = await import('../../../../apps/flue/src/agents/team-data-assistant')
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})

    const agent = mod.createTeamDataAssistantConfig({id})
    expect(agent.tools.map(tool => tool.name)).toContain('applyCategorizations')
    expect(agent.tools.map(tool => tool.name)).toContain('manageCategory')
    expect(agent.tools.map(tool => tool.name)).not.toContain('applyCategorization')
    expect(agent.tools.map(tool => tool.name)).not.toContain('applyCategorizationSuggestion')
  })

  it('uses the stronger bulk-capable model and a predictable virtual workspace cwd', async () => {
    const mod = await import('../../../../apps/flue/src/agents/team-data-assistant')
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})

    const agent = mod.createTeamDataAssistantConfig({id})

    expect(agent.model).toBe('openai/gpt-5.4-mini')
    expect(agent.cwd).toBe('/workspace')
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
