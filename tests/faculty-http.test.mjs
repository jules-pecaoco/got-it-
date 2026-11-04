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

