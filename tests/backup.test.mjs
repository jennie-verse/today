import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayload } from '../src/backup.js';
import { normalizeTask } from '../src/model.js';

const task = normalizeTask({ id: 'existing', title: '보관할 할 일' });
const backup = (tasks = [task]) => ({ format: 'today-backup', version: 1, tasks });

test('valid backup keeps original text and timestamps without mutation', () => {
  const payload = backup([{ ...task, title: '가'.repeat(300) }]);
  const before = structuredClone(payload);
  assert.equal(validatePayload(payload), null);
  assert.deepEqual(payload, before);
});

test('all malformed rows are rejected before any import choice or write', () => {
  for (const invalid of [null, [], {}, { ...task, id: '' }, { ...task, title: '' },
    { ...task, status: 'missing' }, { ...task, type: 'unknown' },
    { ...task, updatedAt: 'invalid' }, { ...task, scheduledFor: '2026-02-30' },
    { ...task, scheduledAtMinutes: 1440 }, { ...task, subtasks: {} },
    { ...task, subtasks: [{ id: 's', title: 'title', done: 'yes' }] }]) {
    assert.match(validatePayload(backup([task, invalid])), /invalid/i);
  }
});

test('duplicate task ids and unsupported backup versions are rejected', () => {
  assert.match(validatePayload(backup([task, task])), /invalid/i);
  for (const version of [-1, 0, 1.5, 3, '1', null]) {
    assert.match(validatePayload({ ...backup(), version }), /version/i);
  }
});

test('legacy rows without optional kind, order, or subtasks are supported', () => {
  const { type, order, subtasks, ...legacy } = task;
  assert.equal(validatePayload(backup([legacy])), null);
  assert.equal(validatePayload(backup([])), null);
});
