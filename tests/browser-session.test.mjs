import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunAccessStore, clearLegacyCredentials, randomId } from '../public/browser-session.js';
import { browserSession, accessToken } from '../src/http-session.mjs';

test('legacy credentials are purged and new run PINs live only in the current page store', () => {
  const session = { instructorToken: 'old-faculty', candidateToken: 'old-student', proctorToken: 'old-proctor', facultyStep: 'results' };
  const local = { 'gotItRunAccess:old': '{"pin":"secret"}', gotItSelectedRun: 'old' };
  globalThis.sessionStorage = { removeItem: key => delete session[key] };
  globalThis.localStorage = Object.assign(local, { removeItem: key => delete local[key] });
  try {
    clearLegacyCredentials();
    assert.deepEqual(session, { facultyStep: 'results' });
    assert.equal(local['gotItRunAccess:old'], undefined);
    assert.equal(local.gotItSelectedRun, 'old');
    const current = createRunAccessStore();
    current.set('run', { pin: 'new-secret' });
    assert.equal(current.get('run').pin, 'new-secret');
    assert.equal(createRunAccessStore().get('run'), null);
    assert.equal(Object.values(local).includes('new-secret'), false);
    current.clear();
    assert.equal(current.get('run'), null);
  } finally { delete globalThis.sessionStorage; delete globalThis.localStorage; }
});

test('HTTPS browser cookies are Secure and cookie input cannot override a supplied bearer token', () => {
  const req = { headers: { 'x-session-mode': 'cookie' }, socket: {} };
  const headers = {};
  const result = browserSession(req, { setHeader: (key, value) => { headers[key] = value; } },
    'instructor', { token: 'opaque-token', expiresAt: 'later' }, 'https://school.example');
  assert.deepEqual(result, { expiresAt: 'later' });
  assert.match(headers['Set-Cookie'], /; Secure$/);
  assert.equal(accessToken({ headers: { authorization: 'Bearer explicit', cookie: 'gotit_faculty=other' } }, 'instructor'), 'explicit');
});

test('browser session and retry identifiers work when randomUUID is unavailable on a LAN origin', () => {
  const original = crypto.randomUUID;
  try {
    crypto.randomUUID = undefined;
    const first = randomId(), second = randomId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  } finally { crypto.randomUUID = original; }
});
