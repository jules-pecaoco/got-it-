import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { exportProject, importProject } from '../web/project-archive.ts';
import { localDraft } from '../public/local-drafts.js';

test('project ZIP roundtrip preserves editable files and rejects unsafe archives', () => {
  const project = { files: { 'index.php': '<?php echo "Café";', 'assets/style.css': 'body { color: navy; }' } };
  assert.deepEqual(importProject(exportProject(project)), project);
  assert.throws(() => importProject(zipSync({ '../index.php': strToU8('<?php') })), /relative|Include/);
  assert.throws(() => importProject(zipSync({ 'index.php': strToU8('x'.repeat(1700001)) })), /too large/);
});

test('local draft recovery handles disabled storage and preserves version metadata', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const draft = localDraft('session-a', 'question-a', storage);
  assert.equal(draft.write({ value: 'unsynced' }, 'revision-1'), true);
  assert.equal(draft.read().response.value, 'unsynced'); assert.equal(draft.read().baseRevision, 'revision-1');
  assert.equal(localDraft('session-b', 'question-a', storage).read(), null);
  draft.clear(); assert.equal(draft.read(), null);
  const blocked = localDraft('a', 'b', { setItem() { throw new Error('Denied'); }, getItem() { throw new Error('Denied'); } });
  assert.equal(blocked.write({}, ''), false); assert.equal(blocked.read(), null);
});
