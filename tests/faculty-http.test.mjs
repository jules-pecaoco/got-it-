import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.DATA_FILE = ':memory:'; process.env.DEMO_MODE = '1';
const { server, store } = await import('../src/server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(path, { method = 'GET', data, token } = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { response, payload: await response.json() };
}
test.after(() => { server.close(); store.close(); });

test('faculty HTTP ownership rejects cross-class reads and edits', async () => {
  store.setFacultyPassword('teacher-a', 'teacher-a-password-long');
  store.setFacultyPassword('teacher-b', 'teacher-b-password-long');
  const first = (await call('/api/instructor/login', { method: 'POST', data: { username: 'teacher-a', password: 'teacher-a-password-long' } })).payload.data.token;
  const second = (await call('/api/instructor/login', { method: 'POST', data: { username: 'teacher-b', password: 'teacher-b-password-long' } })).payload.data.token;
  const classroom = (await call('/api/instructor/classes', { method: 'POST', token: first, data: { name: 'Owned class', section: 'S', roster: [{ candidateId: 'A', displayName: 'Alex' }] } })).payload.data;
  assert.equal((await call(`/api/instructor/classes/${classroom.id}`, { token: second })).response.status, 404);
  assert.equal((await call(`/api/instructor/classes/${classroom.id}`, { method: 'DELETE', token: second })).response.status, 404);
  assert.equal((await call('/api/instructor/classes', { token: second })).payload.data.length, 0);
  assert.equal((await call(`/api/instructor/classes/${classroom.id}`, { token: first })).response.status, 200);
});



test('faculty AI status exposes model choices without credentials and Groq configuration errors do not fall back', async () => {
  store.setFacultyPassword('model-choice', 'model-choice-password-long');
  const token = (await call('/api/instructor/login', { method: 'POST', data: { username: 'model-choice', password: 'model-choice-password-long' } })).payload.data.token;
  assert.equal((await call('/api/instructor/ai/status')).response.status, 401);
  const status = (await call('/api/instructor/ai/status', { token })).payload.data;
  assert.deepEqual(status.providers.map(provider => provider.id), ['gemini', 'groq']);
  assert.ok(status.providers.every(provider => typeof provider.available === 'boolean' && Array.isArray(provider.models)));
  assert.deepEqual(Object.keys(status.providers[1]).sort(), ['available', 'id', 'label', 'models']);
  const previous = process.env.GROQ_API_KEY;
  try {
    process.env.GROQ_API_KEY = '';
    await call('/api/instructor/ai/settings', { method: 'PUT', token, data: { aiProvider: 'groq', aiModel: 'openai/gpt-oss-20b' } });
    const result = await call('/api/instructor/ai/propose', { method: 'POST', token, data: {
      aiProvider: 'groq', aiModel: 'openai/gpt-oss-20b', title: 'Test', subject: 'Tables', kind: 'activity',
      durationMinutes: 30, questionCount: 1, source: { filename: 'lesson.txt', content: 'Search filters matching rows before pagination. Ordering sorts the records by column values. Use table controls to explore rows and find matching records.' },
    } });
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.code, 'AI_NOT_CONFIGURED');
    assert.match(result.payload.message, /GROQ_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  }
});


test('AI settings belong to faculty accounts and survive a new sign-in', async () => {
  store.setFacultyPassword('ai-owner', 'ai-owner-password-long');
  store.setFacultyPassword('ai-other', 'ai-other-password-long');
  const login = async username => (await call('/api/instructor/login', { method: 'POST', data: { username, password: username + '-password-long' } })).payload.data.token;
  const owner = await login('ai-owner'), other = await login('ai-other');
  assert.equal((await call('/api/instructor/ai/settings')).response.status, 401);
  const choice = { aiProvider: 'groq', aiModel: 'openai/gpt-oss-20b' };
  assert.equal((await call('/api/instructor/ai/settings', { method: 'PUT', token: owner, data: choice })).response.status, 200);
  const restored = (await call('/api/instructor/ai/settings', { token: await login('ai-owner') })).payload.data;
  assert.equal(restored.aiProvider, choice.aiProvider); assert.equal(restored.aiModel, choice.aiModel);
  assert.equal((await call('/api/instructor/ai/settings', { token: other })).payload.data.aiProvider, 'gemini');
  assert.equal((await call('/api/instructor/ai/settings', { method: 'PUT', token: other, data: { aiProvider: 'groq', aiModel: 'invalid' } })).response.status, 400);
});
