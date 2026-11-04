import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRequestStatus } from '../public/request-status.js';
import { studentRequestLabel, facultyRequestLabel, proctorRequestLabel } from '../public/request-labels.js';

test('loading labels describe score publication, results checks and each workspace', () => {
  assert.equal(studentRequestLabel('/api/me/results'), 'Checking for your published score…');
  assert.equal(studentRequestLabel('/api/me/session'), 'Loading your saved progress…');
  assert.equal(facultyRequestLabel('/api/instructor/runs/run-id/publish-scores', 'POST'), 'Publishing completed student scores…');
  assert.equal(facultyRequestLabel('/api/instructor/runs/run-id/students/A/publish-scores', 'POST'), 'Publishing student score…');
  assert.equal(facultyRequestLabel('/api/instructor/runs/run-id/students/A/scores/question', 'DELETE'), 'Restoring automatic question score…');
  assert.match(facultyRequestLabel('/api/instructor/classes/class-id', 'DELETE'), /Deleting class/);
  assert.match(proctorRequestLabel('/api/proctor/run'), /student participation and progress/);
  for (const label of [studentRequestLabel('/api/config'), facultyRequestLabel('/api/config'), proctorRequestLabel('/api/config')]) {
    assert.match(label, /settings/);
  }
});

test('overlapping requests retain their context and stay busy until every request finishes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const status = {
    classList: new Set(['hidden']),
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }
  };
  status.classList.remove = key => status.classList.delete(key);
  const text = { textContent: '' };
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { getElementById: id => id === 'request-status' ? status : text };
  globalThis.window = { setTimeout };
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });

  const finishPublishing = beginRequestStatus('Publishing completed student scores…');
  const finishLoading = beginRequestStatus('Loading student scores and participation…');
  const finishDuplicate = beginRequestStatus('Loading student scores and participation…');
  assert.equal(text.textContent, 'Publishing completed student scores… · Loading student scores and participation…');
  assert.equal(status.classList.has('hidden'), false);
  assert.equal(status.attributes['aria-busy'], 'true');

  finishLoading();
  finishLoading();
  assert.match(text.textContent, /Publishing.*Loading/);
  finishPublishing();
  assert.equal(text.textContent, 'Loading student scores and participation…');
  t.mock.timers.tick(220);
  assert.equal(status.classList.has('hidden'), false);

  finishDuplicate();
  // A new request during the hide delay must remain visible.
  const finishChecking = beginRequestStatus('Checking for your published score…');
  t.mock.timers.tick(220);
  assert.equal(status.classList.has('hidden'), false);
  assert.equal(text.textContent, 'Checking for your published score…');
  finishChecking();
  t.mock.timers.tick(220);
  assert.equal(status.classList.has('hidden'), true);
  assert.equal(status.attributes['aria-busy'], 'false');
});
