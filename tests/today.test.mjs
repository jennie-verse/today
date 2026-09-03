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

test('normalizeTask clamps title, defaults status, and allows unlimited subtasks', () => {
  const task = model.normalizeTask({
    title: `  ${'x'.repeat(200)}  `,
    subtasks: Array.from({ length: 7 }, (_, i) => ({ title: `s${i}` })),
  });
  assert.equal(task.title.length, model.LIMITS.title);
  assert.equal(task.status, 'someday');
  assert.equal(task.subtasks.length, 7);
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

test('countTodaySlots only counts today-status tasks for the given day', () => {
  const tasks = [
    model.normalizeTask({ title: 'a', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'b', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'c', status: 'today', todayDate: '2026-08-25' }), // different day
    model.normalizeTask({ title: 'd', status: 'someday' }),
  ];
  assert.equal(model.countTodaySlots(tasks, '2026-08-26'), 2);
  assert.equal(model.canPromoteToToday(tasks, '2026-08-26'), true);
  const full = [...tasks, model.normalizeTask({ title: 'e', status: 'today', todayDate: '2026-08-26' })];
  assert.equal(model.canPromoteToToday(full, '2026-08-26'), true, 'Today has no upper bound');
});

test('Today has no upper bound: every today-status task for the day is returned, in order', () => {
  const tasks = Array.from({ length: 5 }, (_, index) => model.normalizeTask({
    title: `device task ${index + 1}`, status: 'today', todayDate: '2026-08-26',
  }));
  assert.deepEqual(model.todaySlotTasks(tasks, '2026-08-26').map((task) => task.title), [
    'device task 1', 'device task 2', 'device task 3', 'device task 4', 'device task 5',
  ]);
  assert.equal(model.countTodaySlots(tasks, '2026-08-26'), 5);
  assert.equal(model.canPromoteToToday(tasks, '2026-08-26'), true);
});

test('reconcileToday rolls yesterday leftovers forward into today and leaves everything else alone', () => {
  const tasks = [
    model.normalizeTask({ title: 'stale', status: 'today', todayDate: '2026-08-25' }),
    model.normalizeTask({ title: 'fresh', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'backlog', status: 'someday' }),
  ];
  const { tasks: next, rolled } = model.reconcileToday(tasks, '2026-08-26');
  assert.equal(rolled.length, 1);
  const stale = next.find((t) => t.title === 'stale');
  assert.equal(stale.status, 'today');
  assert.equal(stale.todayDate, '2026-08-26');
  const fresh = next.find((t) => t.title === 'fresh');
  assert.equal(fresh.status, 'today');
  assert.equal(fresh.todayDate, '2026-08-26');
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

// ---------- brain-dump stage 1: type/order/tiers ----------

test('taskType defaults missing/unknown type to "task", keeping old records reading correctly', () => {
  assert.equal(model.taskType({ type: 'note' }), 'note');
  assert.equal(model.taskType({ type: 'event' }), 'event');
  assert.equal(model.taskType({}), 'task');
  assert.equal(model.taskType({ type: 'bogus' }), 'task');
  assert.equal(model.taskType(undefined), 'task');
});

test('normalizeTask defaults type to "task" and clamps Note title to LIMITS.note while preserving newlines', () => {
  const task = model.normalizeTask({ title: 'plain' });
  assert.equal(task.type, 'task');
  assert.equal(task.order, null);
  const note = model.normalizeTask({ title: 'line1\nline2', type: 'note' });
  assert.equal(note.type, 'note');
  assert.equal(note.title, 'line1\nline2');
  const longNote = model.normalizeTask({ title: 'x'.repeat(3000), type: 'note' });
  assert.equal(longNote.title.length, model.LIMITS.note);
});

test('migrateOrder assigns order by ascending createdAt, separately per status bucket, only to records missing it', () => {
  const tasks = [
    model.normalizeTask({ title: 'a', status: 'someday', createdAt: '2026-08-01T00:00:00.000Z' }),
    model.normalizeTask({ title: 'b', status: 'someday', createdAt: '2026-08-02T00:00:00.000Z' }),
    model.normalizeTask({ title: 'c', status: 'today', todayDate: '2026-08-26', createdAt: '2026-08-01T00:00:00.000Z' }),
    { ...model.normalizeTask({ title: 'd', status: 'someday', createdAt: '2026-08-03T00:00:00.000Z' }), order: 9 },
  ];
  const changed = model.migrateOrder(tasks);
  const a = changed.find((t) => t.title === 'a');
  const b = changed.find((t) => t.title === 'b');
  const c = changed.find((t) => t.title === 'c');
  assert.ok(a.order < b.order, 'ascending createdAt within the someday bucket');
  assert.equal(c.order, 0, 'today bucket numbers separately from someday');
  assert.equal(changed.find((t) => t.title === 'd'), undefined, 'already-ordered records are left alone');
});

test('todayTierGroups splits Event/Task/Note and sorts events by scheduledAtMinutes (no value last)', () => {
  const tasks = [
    model.normalizeTask({ title: 'note1', type: 'note', status: 'today', todayDate: '2026-08-26', order: 1 }),
    model.normalizeTask({ title: 'ev-late', type: 'event', status: 'today', todayDate: '2026-08-26', scheduledAtMinutes: 900 }),
    model.normalizeTask({ title: 'ev-no-time', type: 'event', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'ev-early', type: 'event', status: 'today', todayDate: '2026-08-26', scheduledAtMinutes: 100 }),
    model.normalizeTask({ title: 'task1', type: 'task', status: 'today', todayDate: '2026-08-26', order: 0 }),
  ];
  const groups = model.todayTierGroups(tasks);
  assert.deepEqual(groups.events.map((t) => t.title), ['ev-early', 'ev-late', 'ev-no-time']);
  assert.deepEqual(groups.tasks.map((t) => t.title), ['task1']);
  assert.deepEqual(groups.notes.map((t) => t.title), ['note1']);
});

test('autoPromoteEvents only promotes Someday events scheduled for today; tasks/notes never auto-promote', () => {
  const tasks = [
    model.normalizeTask({ title: 'event-today', type: 'event', status: 'someday', scheduledFor: '2026-08-26' }),
    model.normalizeTask({ title: 'event-later', type: 'event', status: 'someday', scheduledFor: '2026-08-27' }),
    model.normalizeTask({ title: 'task-today', type: 'task', status: 'someday', scheduledFor: '2026-08-26' }),
    model.normalizeTask({ title: 'note-today', type: 'note', status: 'someday', scheduledFor: '2026-08-26' }),
  ];
  const { tasks: next, promoted } = model.autoPromoteEvents(tasks, '2026-08-26');
  assert.equal(promoted.length, 1);
  const promotedTask = next.find((t) => t.id === promoted[0]);
  assert.equal(promotedTask.title, 'event-today');
  assert.equal(promotedTask.status, 'today');
  assert.equal(promotedTask.todayDate, '2026-08-26');
  assert.equal(next.find((t) => t.title === 'task-today').status, 'someday');
  assert.equal(next.find((t) => t.title === 'note-today').status, 'someday');
});

test('todayDoneTasks/staleDoneTasks split Done by today\'s doneDate, sorted by doneAt ascending', () => {
  const tasks = [
    model.normalizeTask({ title: 'old', status: 'done', doneDate: '2026-08-20', doneAt: '2026-08-20T10:00:00.000Z' }),
    model.normalizeTask({ title: 'today-late', status: 'done', doneDate: '2026-08-26', doneAt: '2026-08-26T15:00:00.000Z' }),
    model.normalizeTask({ title: 'today-early', status: 'done', doneDate: '2026-08-26', doneAt: '2026-08-26T09:00:00.000Z' }),
  ];
  assert.deepEqual(model.todayDoneTasks(tasks, '2026-08-26').map((t) => t.title), ['today-early', 'today-late']);
  assert.deepEqual(model.staleDoneTasks(tasks, '2026-08-26').map((t) => t.title), ['old']);
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

// ---------- type/order (plan §8 stage 1) ----------

test('normalizeTask defaults type to "task" and reads an existing record without type/order correctly', () => {
  const t = model.normalizeTask({ title: 'legacy', status: 'today', todayDate: '2026-08-26' });
  assert.equal(t.type, 'task');
  assert.equal(t.order, null);
});

test('migrateOrder assigns order by ascending createdAt, numbered separately per status bucket', () => {
  const tasks = [
    { ...model.normalizeTask({ title: 'a', status: 'today', todayDate: '2026-08-26' }), createdAt: '2026-08-01T00:00:00.000Z' },
    { ...model.normalizeTask({ title: 'b', status: 'today', todayDate: '2026-08-26' }), createdAt: '2026-08-02T00:00:00.000Z' },
    { ...model.normalizeTask({ title: 'c', status: 'someday' }), createdAt: '2026-08-01T00:00:00.000Z' },
  ];
  const changed = model.migrateOrder(tasks);
  assert.equal(changed.length, 3);
  const a = changed.find((t) => t.title === 'a');
  const b = changed.find((t) => t.title === 'b');
  const c = changed.find((t) => t.title === 'c');
  assert.ok(a.order < b.order, 'today bucket ordered by createdAt');
  assert.equal(c.order, 0, 'someday bucket numbered separately, starting at 0');
});

test('migrateOrder is a no-op for records that already have an order', () => {
  const tasks = [model.normalizeTask({ title: 'a', status: 'someday', order: 5 })];
  assert.deepEqual(model.migrateOrder(tasks), []);
});

test('sortTodayTiers puts events first (by scheduledAtMinutes, no-value last), then tasks, then notes, each by order', () => {
  const tasks = [
    model.normalizeTask({ title: 'note1', type: 'note', status: 'today', todayDate: '2026-08-26', order: 1 }),
    model.normalizeTask({ title: 'task1', type: 'task', status: 'today', todayDate: '2026-08-26', order: 1 }),
    model.normalizeTask({ title: 'event-no-time', type: 'event', status: 'today', todayDate: '2026-08-26' }),
    model.normalizeTask({ title: 'task0', type: 'task', status: 'today', todayDate: '2026-08-26', order: 0 }),
    model.normalizeTask({ title: 'event-9am', type: 'event', status: 'today', todayDate: '2026-08-26', scheduledAtMinutes: 540 }),
  ];
  const sorted = model.sortTodayTiers(tasks).map((r) => r.task.title);
  assert.deepEqual(sorted, ['event-9am', 'event-no-time', 'task0', 'task1', 'note1']);
});

test('autoPromoteEvents only promotes Someday events scheduled for today, never tasks or notes', () => {
  const key = '2026-08-26';
  const tasks = [
    model.normalizeTask({ title: 'evt', type: 'event', status: 'someday', scheduledFor: key }),
    model.normalizeTask({ title: 'task', type: 'task', status: 'someday', scheduledFor: key }),
    model.normalizeTask({ title: 'note', type: 'note', status: 'someday', scheduledFor: key }),
  ];
  const { tasks: next, promoted } = model.autoPromoteEvents(tasks, key);
  assert.equal(promoted.length, 1);
  const evt = next.find((t) => t.title === 'evt');
  assert.equal(evt.status, 'today');
  assert.equal(evt.todayDate, key);
  assert.equal(next.find((t) => t.title === 'task').status, 'someday');
  assert.equal(next.find((t) => t.title === 'note').status, 'someday');
});

test('todayDoneTasks only returns items done today, sorted by doneAt ascending; staleDoneTasks returns the rest', () => {
  const tasks = [
    model.normalizeTask({ title: 'old', status: 'done', doneDate: '2026-08-20', doneAt: '2026-08-20T09:00:00.000Z' }),
    model.normalizeTask({ title: 'today-late', status: 'done', doneDate: model.todayKey(), doneAt: '2026-08-26T15:00:00.000Z' }),
    model.normalizeTask({ title: 'today-early', status: 'done', doneDate: model.todayKey(), doneAt: '2026-08-26T09:00:00.000Z' }),
  ];
  const todaysDone = model.todayDoneTasks(tasks, model.todayKey());
  assert.deepEqual(todaysDone.map((t) => t.title), ['today-early', 'today-late']);
  const stale = model.staleDoneTasks(tasks, model.todayKey());
  assert.deepEqual(stale.map((t) => t.title), ['old']);
});

// ---------- brain-dump stage 2: Someday sort/filter, kind-switching, Turn into tasks ----------

test('somedayFiltered sorts by order ascending (input order), not scheduledFor/title', () => {
  const tasks = [
    model.normalizeTask({ title: 'z-first', status: 'someday', order: 0, scheduledFor: '2026-09-05' }),
    model.normalizeTask({ title: 'a-second', status: 'someday', order: 1, scheduledFor: '2026-09-01' }),
    model.normalizeTask({ title: 'not-someday', status: 'today', todayDate: model.todayKey(), order: 0 }),
  ];
  assert.deepEqual(model.somedayFiltered(tasks, 'all').map((t) => t.title), ['z-first', 'a-second']);
});

test('somedayFiltered narrows by kind: all/task/note', () => {
  const tasks = [
    model.normalizeTask({ title: 'note1', type: 'note', status: 'someday', order: 0 }),
    model.normalizeTask({ title: 'task1', type: 'task', status: 'someday', order: 1 }),
    model.normalizeTask({ title: 'event1', type: 'event', status: 'someday', order: 2 }),
  ];
  assert.deepEqual(model.somedayFiltered(tasks, 'task').map((t) => t.title), ['task1']);
  assert.deepEqual(model.somedayFiltered(tasks, 'note').map((t) => t.title), ['note1']);
  assert.deepEqual(model.somedayFiltered(tasks, 'all').map((t) => t.title), ['note1', 'task1', 'event1']);
});

test('switchTaskKind converts Task <-> Note <-> Event and drops subtasks going to Note', () => {
  const task = model.normalizeTask({
    title: 'a task', type: 'task', status: 'someday',
    subtasks: [{ title: 'sub1' }, { title: 'sub2' }],
  });
  const asNote = model.switchTaskKind(task, 'note');
  assert.equal(asNote.type, 'note');
  assert.deepEqual(asNote.subtasks, [], 'subtasks are discarded converting Task -> Note');

  const note = model.normalizeTask({ title: 'a note', type: 'note', status: 'someday' });
  const asTask = model.switchTaskKind(note, 'task');
  assert.equal(asTask.type, 'task');
  assert.deepEqual(asTask.subtasks, [], 'Note -> Task never fabricates subtasks');

  const asEvent = model.switchTaskKind(task, 'event');
  assert.equal(asEvent.type, 'event');
  assert.equal(asEvent.scheduledAtMinutes, null, 'no time is fabricated switching to Event');

  assert.throws(() => model.switchTaskKind(task, 'bogus'));
});

test('splitNoteLines splits only on newlines, discards blank lines, no sentence-splitting', () => {
  assert.deepEqual(model.splitNoteLines('line1\n\nline2\n  \nline3'), ['line1', 'line2', 'line3']);
  assert.deepEqual(model.splitNoteLines('one sentence. another sentence.'), ['one sentence. another sentence.']);
  assert.deepEqual(model.splitNoteLines(''), []);
  assert.deepEqual(model.splitNoteLines('  \n \n'), []);
});

test('tasksFromNoteLines creates Someday Task drafts with order continuing right after the source note', () => {
  const drafts = model.tasksFromNoteLines(['first', 'second', 'third'], 4);
  assert.equal(drafts.length, 3);
  assert.deepEqual(drafts.map((d) => d.order), [5, 6, 7]);
  assert.ok(drafts.every((d) => d.type === 'task' && d.status === 'someday'));
  assert.deepEqual(drafts.map((d) => d.title), ['first', 'second', 'third']);
});

test('tasksFromNoteLines treats a missing/non-finite source order as 0', () => {
  const drafts = model.tasksFromNoteLines(['only'], null);
  assert.equal(drafts[0].order, 1);
});

test('normalizeTask accepts "clip" as a source, keeps "tide" working, and defaults everything else to "manual"', () => {
  assert.equal(model.normalizeTask({ title: 'a', source: 'clip' }).source, 'clip');
  assert.equal(model.normalizeTask({ title: 'a', source: 'tide' }).source, 'tide');
  assert.equal(model.normalizeTask({ title: 'a', source: 'bogus' }).source, 'manual');
  assert.equal(model.normalizeTask({ title: 'a' }).source, 'manual');
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

test('taskToJournalRecord includes the row\'s type in data (task/note/event) for Daybook rendering', () => {
  const task = model.normalizeTask({ title: 'a task', type: 'task', status: 'today', todayDate: '2026-08-26' });
  const note = model.normalizeTask({ title: 'a note', type: 'note', status: 'done', doneDate: '2026-08-26' });
  const event = model.normalizeTask({ title: 'an event', type: 'event', status: 'today', todayDate: '2026-08-26', scheduledAtMinutes: 540 });
  assert.equal(taskToJournalRecord(task, {}).data.type, 'task');
  assert.equal(taskToJournalRecord(note, {}).data.type, 'note');
  assert.equal(taskToJournalRecord(event, {}).data.type, 'event');
});

test('a plain Someday task (no todayDate, not done) cannot be projected as a task record', () => {
  const someday = model.normalizeTask({ title: 'a', status: 'someday', scheduledFor: '2026-08-30' });
  assert.throws(() => taskToJournalRecord(someday, {}));
});

test('taskActivityRecord keeps the final destination and done state and hides the title when content is off', () => {
  const entry = { taskId: 't1', date: '2026-08-26', actions: ['promoted', 'completed'], firstAt: '2026-08-26T09:00:00-05:00', lastAt: '2026-08-26T09:05:00-05:00', title: 'fallback', destination: 'today', done: true, finalStatus: 'done' };
  const record = taskActivityRecord(entry, { title: '세탁' }, { includeContent: true });
  assert.equal(record.id, 't1:2026-08-26');
  assert.equal(record.kind, 'task-activity');
  assert.equal(record.title, '세탁');
  assert.deepEqual(record.data.actions, ['promoted', 'completed']);
  assert.equal(record.data.destination, 'today');
  assert.equal(record.data.done, true);
  assert.equal(record.data.finalStatus, 'done');
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
