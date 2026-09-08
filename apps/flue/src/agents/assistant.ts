'use agent';
import { useModel, useSandbox } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import '../mock-model.ts';

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity. The return value is the
// agent's system prompt.
export function Assistant() {
	useModel('mock/local');
	useSandbox(local());
	return 'You are a helpful assistant. Keep replies short.';
}
