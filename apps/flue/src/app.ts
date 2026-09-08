import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Assistant } from './agents/assistant.ts';

const app = new Hono();

app.get('/health', c => c.text('Ready'));

// This private service is accessible only through the authenticated web boundary.
app.use('*', async (c, next) => {
	const token = process.env.FLUE_INTERNAL_TOKEN;
	if (!token || c.req.header('authorization') !== `Bearer ${token}`) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	return next();
});
app.route('/agents/assistant', createAgentRouter(Assistant));

export default app;
