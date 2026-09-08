import assert from 'node:assert/strict'
import process from 'node:process'

const {Request, Response} = globalThis

// Replace only HTTP transport: exercise Flue's real OpenAI provider without
// credentials or network access. Unexpected requests fail instead of escaping.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.headers.get('authorization'), 'Bearer test-not-a-real-key')
  const body = await request.json()
  assert.equal(body.model, process.env.FLUE_MODEL?.split('/')[1] ?? 'gpt-5.5')
  assert.equal(body.stream, true)
  const item = {id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'OpenAI transport stub reply', annotations: []}]}
  const events = [
    {type: 'response.created', response: {id: 'resp_test', model: body.model}},
    {type: 'response.output_item.added', output_index: 0, item: {...item, status: 'in_progress', content: []}},
    {type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: {type: 'output_text', text: '', annotations: []}},
    {type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text},
    {type: 'response.output_item.done', output_index: 0, item},
    {type: 'response.completed', response: {id: 'resp_test', model: body.model, status: 'completed', output: [item], usage: {input_tokens: 10, output_tokens: 5, total_tokens: 15}}},
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: {'content-type': 'text/event-stream'},
  })
}
