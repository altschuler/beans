import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { setProvider } from '@flue/runtime';

// Stage 2 is deliberately mock-only. Never fall back to environment credentials.
if (process.env.FLUE_MOCK !== '1') {
	throw new Error('Only mock mode is configured. Run with FLUE_MOCK=1; no provider keys are needed.');
}

const mock = fauxProvider({
	provider: 'mock',
	models: [{ id: 'local' }],
	tokenSize: { min: 64, max: 64 },
});
mock.setResponses([
	fauxAssistantMessage(fauxToolCall('bash', {
		command: "printf 'local sandbox works\\n'",
	}), { stopReason: 'toolUse' }),
	context => {
		const result = context.messages.at(-1);
		if (result?.role !== 'toolResult' || result.isError) {
			throw new Error('Expected a successful local sandbox tool result');
		}
		const output = result.content.filter(part => part.type === 'text').map(part => part.text).join('');
		const turns = context.messages.filter(message => message.role === 'user').length;
		return fauxAssistantMessage(`Mock reply (${turns} user messages): ${output.trim()}`);
	},
]);
setProvider(mock.provider);
