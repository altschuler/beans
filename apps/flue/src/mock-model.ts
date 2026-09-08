import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Provider } from '@earendil-works/pi-ai';
import { setProvider } from '@flue/runtime';

// Never fall back to environment credentials, even if provider keys are present.
if (process.env.FLUE_MOCK !== '1' || process.env.NODE_ENV === 'production') {
	throw new Error('Only mock mode is configured. Run with FLUE_MOCK=1; no provider keys are needed.');
}

const options = {
	provider: 'mock',
	api: 'mock-local',
	models: [{ id: 'local' }],
	tokensPerSecond: 20,
	tokenSize: { min: 1, max: 1 },
};

// Each model call gets its own queue. Decisions depend only on this conversation's
// durable context, never a process-global turn counter or shared response queue.
const stream: Provider['streamSimple'] = (model, context, streamOptions) => {
	const mock = fauxProvider(options);
	mock.setResponses([context => {
		const result = context.messages.at(-1);
		if (result?.role !== 'toolResult') {
			return fauxAssistantMessage(fauxToolCall('bash', {
				command: "printf 'local sandbox works\\n'",
			}), { stopReason: 'toolUse' });
		}
		const output = result.content.filter(part => part.type === 'text').map(part => part.text).join('');
		if (result.isError || output.trim() !== 'local sandbox works') {
			throw new Error('Mock sandbox check failed');
		}
		const turns = context.messages.filter(message => message.role === 'user').length;
		return fauxAssistantMessage(`Mock reply (${turns} user messages): local sandbox works`);
	}]);
	return mock.provider.streamSimple(model, context, streamOptions);
};
setProvider({ ...fauxProvider(options).provider, stream, streamSimple: stream });
