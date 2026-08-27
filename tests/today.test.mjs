import assert from 'node:assert/strict';
import test from 'node:test';
import * as model from '../src/model.js';
import { parseNaturalLanguage } from '../src/nlp-date.js';
import { taskToJournalRecord, taskActivityRecord, journalDateFor } from '../src/journal-record.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
globalThis.localStorage = memoryStorage();
const sync = await import('../src/sync.js');

// ---------- model.js ----------

test('normalizeTask clamps title, defaults status, and caps subtasks at 5', () => {
  const task = model.normalizeTask({
    title: `  ${'x'.repeat(200)}  `,
    subtasks: Array.from({ length: 7 }, (_, i) => ({ title: `s${i}` })),
  });
  assert.equal(task.title.length, model.LIMITS.title);
  assert.equal(task.status, 'someday');
  assert.equal(task.subtasks.length, model.MAX_SUBTASKS);
  assert.throws(() => model.normalizeTask({ title: '   ' }));
  assert.throws(() => model.normalizeSubtask({ title: '' }));
});

test('todayDate/doneAt/doneDate are only set for the matching status', () => {
  const today = model.normalizeTask({ title: 'a', status: 'today', todayDate: '2026-08-26' });
  assert.equal(today.todayDate, '2026-08-26');
  assert.equal(today.doneDate, null);
  const someday = model.normalizeTask({ ...today, status: 'someday' });
  assert.equal(someday.todayDate, null);
  const done = model.normalizeTask({ ...someday, status: 'done' });
  assert.equal(done.doneDate, model.todayKey());
  assert.ok(done.doneAt);
});

test('the 3-slot rule only counts today-status tasks for the given day', () => {
  const tasks = [
    model.normalizeTask({ title: 'a', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'b', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'c', status: 'today', todayDate: '2026-08-25' }), // different day
    model.normalizeTask({ title: 'd', status: 'someday' }),
  ];
  assert.equal(model.countTodaySlots(tasks, '2026-08-26'), 2);
  assert.equal(model.canPromoteToToday(tasks, '2026-08-26'), true);
  const full = [...tasks, model.normalizeTask({ title: 'e', status: 'today', todayDate: '2026-08-26' })];
  assert.equal(model.canPromoteToToday(full, '2026-08-26'), false);
});

test('reconcileToday silently reverts yesterday leftovers to Someday and nothing else', () => {
  const tasks = [
    model.normalizeTask({ title: 'stale', status: 'today', todayDate: '2026-08-25' }),
    model.normalizeTask({ title: 'fresh', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'backlog', status: 'someday' }),
  ];
  const { tasks: next, reverted } = model.reconcileToday(tasks, '2026-08-26');
  assert.equal(reverted.length, 1);
  const stale = next.find((t) => t.title === 'stale');
  assert.equal(stale.status, 'someday');
  assert.equal(stale.todayDate, null);
  const fresh = next.find((t) => t.title === 'fresh');
  assert.equal(fresh.status, 'today');
});

test('today candidates are Someday tasks scheduled for today, and are never Today tasks', () => {
  const tasks = [
    model.normalizeTask({ title: 'a', status: 'someday', scheduledFor: '2026-08-26' }),
    model.normalizeTask({ title: 'b', status: 'someday', scheduledFor: '2026-08-27' }),
    model.normalizeTask({ title: 'c', status: 'today', todayDate: '2026-08-26', scheduledFor: '2026-08-26' }),
  ];
  const candidates = model.todayCandidates(tasks, '2026-08-26');
  assert.deepEqual(candidates.map((t) => t.title), ['a']);
});

test('doneTasksByDate groups by doneDate, most recent day first', () => {
  const tasks = [
    model.normalizeTask({ title: 'old', status: 'done', doneDate: '2026-08-20' }),
    model.normalizeTask({ title: 'new1', status: 'done', doneDate: '2026-08-26' }),
    model.normalizeTask({ title: 'new2', status: 'done', doneDate: '2026-08-26' }),
    model.normalizeTask({ title: 'pending', status: 'someday' }),
  ];
  const groups = model.doneTasksByDate(tasks);
  assert.deepEqual(groups.map(([date]) => date), ['2026-08-26', '2026-08-20']);
  assert.equal(groups[0][1].length, 2);
});

test('inferTaskAction covers created/deleted/completed/reopened/promoted/deferred/edited', () => {
  const someday = model.normalizeTask({ title: 'a', status: 'someday' });
  const today = model.normalizeTask({ ...someday, status: 'today', todayDate: '2026-08-26' });
  const done = model.normalizeTask({ ...today, status: 'done' });
  assert.equal(model.inferTaskAction(someday, null), 'created');
  assert.equal(model.inferTaskAction(null, someday), 'deleted');
  assert.equal(model.inferTaskAction(done, today), 'completed');
  assert.equal(model.inferTaskAction(today, done), 'reopened');
  assert.equal(model.inferTaskAction(today, someday), 'promoted');
  assert.equal(model.inferTaskAction(someday, today), 'deferred');
  assert.equal(model.inferTaskAction(model.normalizeTask({ ...someday, title: 'b' }), someday), 'edited');
});

// ---------- nlp-date.js ----------
// A fixed Wednesday so weekday math is deterministic across the suite.
const WED = new Date(2026, 7, 26, 10, 0, 0);

test('Korean relative days: 오늘/내일/모레 strip the phrase and set scheduledFor', () => {
  assert.deepEqual(parseNaturalLanguage('오늘 장보기', { now: WED }), { title: '장보기', scheduledFor: '2026-08-26', scheduledAtMinutes: null });
  assert.deepEqual(parseNaturalLanguage('내일 회의', { now: WED }), { title: '회의', scheduledFor: '2026-08-27', scheduledAtMinutes: null });
  assert.deepEqual(parseNaturalLanguage('모레 병원', { now: WED }), { title: '병원', scheduledFor: '2026-08-28', scheduledAtMinutes: null });
});

test('bare Korean weekday means the nearest occurrence, at least one day out', () => {
  const mon = new Date(2026, 7, 24, 10, 0, 0); // Monday
  assert.equal(parseNaturalLanguage('화요일 회의', { now: mon }).scheduledFor, '2026-08-25');
  assert.equal(parseNaturalLanguage('월요일 회의', { now: mon }).scheduledFor, '2026-08-31'); // not today
});

test('다음주 X요일 always lands in the following calendar week', () => {
  assert.equal(parseNaturalLanguage('다음주 화요일 회의', { now: WED }).scheduledFor, '2026-09-01');
  const mon = new Date(2026, 7, 24, 10, 0, 0);
  assert.equal(parseNaturalLanguage('다음주 화요일 회의', { now: mon }).scheduledFor, '2026-09-01');
});

test('N월 N일 sets an explicit calendar date', () => {
  assert.equal(parseNaturalLanguage('8월 30일 생일파티', { now: WED }).scheduledFor, '2026-08-30');
  assert.equal(parseNaturalLanguage('13월 40일 존재안함', { now: WED }).scheduledFor, null);
});

test('오전/오후 H시(분) and HH:MM set scheduledAtMinutes and default the date to today', () => {
  assert.deepEqual(parseNaturalLanguage('오전 9시 전화', { now: WED }), { title: '전화', scheduledFor: '2026-08-26', scheduledAtMinutes: 540 });
  assert.equal(parseNaturalLanguage('오후 3시 30분 미팅', { now: WED }).scheduledAtMinutes, 15 * 60 + 30);
  assert.equal(parseNaturalLanguage('오후 12시 점심', { now: WED }).scheduledAtMinutes, 12 * 60);
  assert.equal(parseNaturalLanguage('오전 12시 기상', { now: WED }).scheduledAtMinutes, 0);
  assert.equal(parseNaturalLanguage('15:30 저녁약속', { now: WED }).scheduledAtMinutes, 15 * 60 + 30);
});

test('English today/tomorrow/next X and Nam/pm are recognized', () => {
  assert.deepEqual(parseNaturalLanguage('today gym', { now: WED }), { title: 'gym', scheduledFor: '2026-08-26', scheduledAtMinutes: null });
  assert.equal(parseNaturalLanguage('tomorrow 9am call', { now: WED }).scheduledFor, '2026-08-27');
  assert.equal(parseNaturalLanguage('tomorrow 9am call', { now: WED }).scheduledAtMinutes, 540);
  assert.equal(parseNaturalLanguage('next Tue lunch', { now: WED }).scheduledFor, '2026-09-01');
  assert.equal(parseNaturalLanguage('9:30pm movie', { now: WED }).scheduledAtMinutes, 21 * 60 + 30);
});

test('recurring phrases are intentionally left unparsed, verbatim', () => {
  assert.deepEqual(parseNaturalLanguage('매주 화요일 청소', { now: WED }), { title: '매주 화요일 청소', scheduledFor: null, scheduledAtMinutes: null });
  assert.deepEqual(parseNaturalLanguage('every Monday standup', { now: WED }), { title: 'every Monday standup', scheduledFor: null, scheduledAtMinutes: null });
});

test('unrecognized input is kept verbatim with no date and no error', () => {
  assert.deepEqual(parseNaturalLanguage('재무 챕터 3 읽기', { now: WED }), { title: '재무 챕터 3 읽기', scheduledFor: null, scheduledAtMinutes: null });
  assert.deepEqual(parseNaturalLanguage('   ', { now: WED }), { title: '', scheduledFor: null, scheduledAtMinutes: null });
});

// ---------- journal-record.js ----------

test('journalDateFor only projects Today (by todayDate) and Done (by doneDate) tasks', () => {
  assert.equal(journalDateFor(model.normalizeTask({ title: 'a', status: 'someday', scheduledFor: '2026-08-30' })), null);
  assert.equal(journalDateFor(model.normalizeTask({ title: 'a', status: 'today', todayDate: '2026-08-26' })), '2026-08-26');
  assert.equal(journalDateFor(model.normalizeTask({ title: 'a', status: 'done', doneDate: '2026-08-20' })), '2026-08-20');
});

test('taskToJournalRecord sends counts by default and only sends subtask text when both toggles are on', () => {
  const task = model.normalizeTask({
    title: '원고 교정 2절', status: 'today', todayDate: '2026-08-26',
    subtasks: [{ title: '1절 반영', done: true }, { title: '각주 정리', done: false }],
  });
  const withoutSubtaskText = taskToJournalRecord(task, { includeContent: true, includeSubtaskText: false });
  assert.equal(withoutSubtaskText.kind, 'task');
  assert.equal(withoutSubtaskText.title, '원고 교정 2절');
  assert.equal(withoutSubtaskText.data.subtaskCount, 2);
  assert.equal(withoutSubtaskText.data.subtaskDoneCount, 1);
  assert.equal(withoutSubtaskText.data.subtasks, undefined);

  const withSubtaskText = taskToJournalRecord(task, { includeContent: true, includeSubtaskText: true });
  assert.deepEqual(withSubtaskText.data.subtasks, [{ title: '1절 반영', done: true }, { title: '각주 정리', done: false }]);

  const contentOff = taskToJournalRecord(task, { includeContent: false, includeSubtaskText: true });
  assert.equal(contentOff.title, 'Today task');
  assert.equal(contentOff.data.subtasks, undefined, 'subtask text never leaks when the overall content toggle is off');
  assert.equal(contentOff.data.contentIncluded, false);
});

test('a plain Someday task (no todayDate, not done) cannot be projected as a task record', () => {
  const someday = model.normalizeTask({ title: 'a', status: 'someday', scheduledFor: '2026-08-30' });
  assert.throws(() => taskToJournalRecord(someday, {}));
});

test('taskActivityRecord keys by taskId:activityDate and hides the title when content is off', () => {
  const entry = { taskId: 't1', date: '2026-08-26', actions: ['promoted', 'completed'], firstAt: '2026-08-26T09:00:00-05:00', lastAt: '2026-08-26T09:05:00-05:00', title: 'fallback' };
  const record = taskActivityRecord(entry, { title: '세탁' }, { includeContent: true });
  assert.equal(record.id, 't1:2026-08-26');
  assert.equal(record.kind, 'task-activity');
  assert.equal(record.title, '세탁');
  assert.deepEqual(record.data.actions, ['promoted', 'completed']);
  const hidden = taskActivityRecord(entry, { title: '세탁' }, { includeContent: false });
  assert.equal(hidden.title, 'Today task');
});

// ---------- sync.js (device sync, same design as loom/tide/folio) ----------

test('sync is disabled by default, matching every other app', () => {
  assert.equal(sync.isEnabled(), false);
  sync.setEnabled(true);
  assert.equal(sync.isEnabled(), true);
  sync.setEnabled(false);
  assert.equal(sync.isEnabled(), false);
});

test('isReady requires enabled + token + context, same as loom', () => {
  assert.equal(sync.isReady(), false);
  sync.saveToken('github_pat_fixture');
  assert.equal(sync.isReady(), false, 'token alone is not enough');
  sync.setEnabled(true);
  assert.equal(sync.isReady(), false, 'still no context id');
  sync.clearToken();
  sync.setEnabled(false);
});

test('a tombstone for a locally deleted task beats an older remote copy, but a newer edit undoes the tombstone', () => {
  const deletedAt = '2026-08-26T10:00:00.000Z';
  const tombstones = [{ id: 'task-1', deletedAt }];
  const staleRemoteCopy = { id: 'task-1', title: 'old', updatedAt: '2026-08-26T09:00:00.000Z' };
  const survivor = { id: 'task-2', title: 'kept', updatedAt: '2026-08-26T09:00:00.000Z' };
  const revivedByLaterEdit = { id: 'task-1', title: 'edited after delete', updatedAt: '2026-08-26T11:00:00.000Z' };

  assert.deepEqual(sync.applyTaskTombstones([staleRemoteCopy, survivor], tombstones), [survivor]);
  assert.deepEqual(sync.applyTaskTombstones([revivedByLaterEdit, survivor], tombstones), [revivedByLaterEdit, survivor]);
});

test('deleting then recreating the same id locally clears its tombstone, so it is not deleted again on the next sync', () => {
  sync.recordTaskDeletion({ id: 'task-9' });
  assert.deepEqual(sync.getTaskTombstones().map((t) => t.id), ['task-9']);
  sync.clearTaskTombstone('task-9');
  assert.deepEqual(sync.getTaskTombstones(), []);
});

test('merging tombstones from another device keeps the newest deletedAt per id, deduplicated', () => {
  sync.recordTaskDeletion({ id: 'dup' });
  const [{ deletedAt: firstDeletedAt }] = sync.getTaskTombstones().filter((t) => t.id === 'dup');
  const merged = sync.mergeTaskTombstones([
    { id: 'dup', deletedAt: '2020-01-01T00:00:00.000Z' }, // older — must lose
    { id: 'other', deletedAt: '2026-08-26T12:00:00.000Z' },
  ]);
  const dup = merged.find((t) => t.id === 'dup');
  assert.equal(dup.deletedAt, firstDeletedAt, 'the newer local tombstone must not be overwritten by an older incoming one');
  assert.ok(merged.some((t) => t.id === 'other'));
  sync.clearTaskTombstone('dup');
  sync.clearTaskTombstone('other');
});

test('describeError produces a plain English line for every error type sync.js can throw', () => {
  assert.match(sync.describeError({ type: 'auth' }), /token/i);
  assert.match(sync.describeError({ type: 'toolarge' }), /too large/i);
  assert.match(sync.describeError(null), /failed/i);
});
