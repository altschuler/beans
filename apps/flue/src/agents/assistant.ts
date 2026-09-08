'use agent';
import { useModel, useSandbox } from '@flue/runtime';
import { local } from '@flue/runtime/node';

// Mocking is explicit and takes precedence over any configured provider or keys.
if (process.env.FLUE_MOCK === '1') await import('../mock-model.ts');

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity. The return value is the
// agent's system prompt.
export function Assistant() {
	useModel(process.env.FLUE_MOCK === '1' ? 'mock/local' : (process.env.FLUE_MODEL || 'openai/gpt-5.5'));
	useSandbox(local());
	return 'You are a helpful assistant. Keep replies short.';
}
