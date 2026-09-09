import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, parseClock, formatClock, wallToIso, wallCandidates, validZonedIso, isoAt, simpleDay } from '../src/timeline-time.js';
import { reviseEntry, validateEntry, mergeEntries } from '../src/timeline-model.js';
import { timelineMarkdown } from '../src/timeline-markdown.js';
import { validatePayload } from '../src/backup.js';
import { decodeTimeline, encodeTimeline } from '../src/timeline-sync.js';
const zone = 'America/Chicago';
const now = Date.parse('2026-09-09T04:00:00Z');
const row = (patch = {}) => reviseEntry({ title: '', startedAt: wallToIso('2026-09-08', 490, zone), endedAt: null, timeZone: zone, ...patch }, null, { now });

test('AM/PM input variants, midnight, noon and explicit 24-hour values', () => {
  for (const text of ['8:10am','8:10 am','08:10 AM','8:10Am']) assert.equal(parseClock(text),490);
  for (const [text, expected] of [['8am',480],['8 pm',1200],['8:10 pm',1210],['12am',0],['12:00 AM',0],['12pm',720],['20:10',1210],['00:10',10]]) assert.equal(parseClock(text),expected);
  for (const text of ['8:10','13am','0pm','8:70am','24:00','8:1am']) assert.throws(() => parseClock(text));
});
test('quick input consumes complete ranges and allows an empty title', () => {
  for (const text of ['8:10am-8:40am 식사','8:10 am - 8:40 am 식사','8:10am–8:40am 식사','8:10am ~ 8:40am 식사']) assert.deepEqual(parseQuick(text), {startMinutes:490,endMinutes:520,title:'식사'});
  assert.deepEqual(parseQuick('8:10am'),{startMinutes:490,endMinutes:null,title:''});
  assert.deepEqual(parseQuick('샤워'),{startMinutes:null,endMinutes:null,title:'샤워'});
  for (const text of ['','8:10am -','8:10am 8:40am','8:10-8:40am','8:10am\n식사']) assert.throws(() => parseQuick(text),text);
});
test('a time-only record becomes an interval and back without changing identity or createdAt', () => {
  const first = row(); const next = reviseEntry({endedAt:wallToIso('2026-09-08',520,zone),title:'샤워'},first,{now:now+1});
  assert.equal(next.id,first.id); assert.equal(next.createdAt,first.createdAt); assert.equal(next.bucket,first.bucket); assert.equal(next.isRunning,false);
  const removed = reviseEntry({endedAt:null},next,{now:now+2}); assert.equal(removed.id,first.id); assert.equal(removed.endedAt,null); assert.equal(removed.isRunning,false);
  assert.equal(mergeEntries([first],[next],[removed]).entries.length,1);
  assert.equal(mergeEntries([first],[next],[removed]).conflicts.length,0);
});
test('explicit running flag, zero-minute interval, future and inverted interval validation', () => {
  const first=row({isRunning:true}); assert.equal(first.isRunning,true);
  const ended=reviseEntry({endedAt:first.startedAt},first,{now}); assert.equal(ended.isRunning,false);
  assert.throws(()=>row({endedAt:wallToIso('2026-09-08',480,zone)}),/End/);
  assert.throws(()=>row({startedAt:wallToIso('2026-09-09',480,zone)}),/future/);
  assert.throws(()=>validateEntry({...ended,isRunning:true}),/current/);
});
test('time zone conversion preserves wall times and rejects gaps without choosing repeated hours', () => {
  assert.equal(isoAt('2026-09-08T13:10:10Z',zone),'2026-09-08T08:10:00-05:00');
  assert.equal(wallCandidates('2026-03-08',150,zone).length,0);
  const repeated=wallCandidates('2026-11-01',90,zone); assert.equal(repeated.length,2);
  assert.throws(()=>wallToIso('2026-11-01',90,zone),/twice/);
  assert.equal(wallToIso('2026-11-01',90,zone,'-06:00'),repeated[1]);
  assert.equal(validZonedIso('2026-02-30T08:10:00-06:00',zone),false);
  assert.equal(simpleDay('2026-11-01',[row()]),false);
});
test('day movement preserves the sync bucket; cross-midnight output is owned by the start day', () => {
  const first=row({startedAt:wallToIso('2026-09-07',1430,zone),endedAt:wallToIso('2026-09-08',20,zone),title:'공부'});
  assert.equal(timelineMarkdown([first],'2026-09-07'),'11:50 PM - 12:20 AM (+1d) 공부\n');
  assert.equal(timelineMarkdown([first],'2026-09-08'),'');
  const moved=reviseEntry({startedAt:wallToIso('2026-08-01',480,zone),endedAt:null},first,{now}); assert.equal(moved.bucket,first.bucket); assert.equal(moved.id,first.id);
});
test('requested Markdown fixture has both AM/PM, empty titles and hard line breaks', () => {
  const items = [[490,null,'샤워'],[510,540,'식사'],[560,700,'공부'],[720,760,''],[1200,null,'티비']].map(([a,b,title])=>row({startedAt:wallToIso('2026-09-08',a,zone),endedAt:b===null?null:wallToIso('2026-09-08',b,zone),title}));
  assert.equal(timelineMarkdown(items.reverse(),'2026-09-08'),'08:10 AM 샤워  \n08:30 AM - 09:00 AM 식사  \n09:20 AM - 11:40 AM 공부  \n12:00 PM - 12:40 PM  \n08:00 PM 티비\n');
  assert.equal(formatClock(1210),'08:10 PM');
});
test('concurrent title and end changes retain both heads; resolving prevents old heads returning', () => {
  const first=row(); const a=reviseEntry({title:'샤워'},first,{now:now+1}); const b=reviseEntry({endedAt:wallToIso('2026-09-08',520,zone)},first,{now:now+2});
  const merged=mergeEntries([a],[b]); assert.equal(merged.entries.length,1); assert.equal(merged.conflicts.length,1);
  const resolved=reviseEntry({title:a.title,endedAt:b.endedAt},b,{known:[a],now:now+3});
  const again=mergeEntries([first,a,b,resolved]); assert.equal(again.entries[0].title,'샤워'); assert.equal(again.conflicts.length,0);
  const deleted=reviseEntry({deletedAt:new Date(now).toISOString()},resolved,{now:now+4}); assert.equal(mergeEntries([first,a,b,deleted]).entries[0].deletedAt,deleted.deletedAt);
});
test('v2 backup validates all timeline records before import, preserving v1 compatibility', () => {
  const payload={format:'today-backup',version:2,tasks:[],timelineEntries:[row()],timelineConflicts:[]};
  assert.equal(validatePayload(payload),null); assert.equal(validatePayload({format:'today-backup',version:1,tasks:[]}),null);
  assert.match(validatePayload({...payload,timelineEntries:undefined}),/timeline/i);
  assert.match(validatePayload({...payload,timelineEntries:[payload.timelineEntries[0],payload.timelineEntries[0]]}),/Duplicate/);
  assert.match(validatePayload({...payload,timelineEntries:[{...payload.timelineEntries[0],title:'x\ny'}]}),/one line/);
});
test('remote envelope validates version, bucket and UTF-8 size without changing its data', () => {
  const r=row(), args={context:'iphone-home',bucket:r.bucket,entries:[r],conflicts:[]};
  const encoded=encodeTimeline(args); assert.deepEqual(decodeTimeline(encoded,args).entries,[r]);
  assert.throws(()=>decodeTimeline(encoded,{...args,bucket:'2026-08'}));
  assert.throws(()=>encodeTimeline({...args,entries:Array.from({length:2500},()=>({...r,title:'가'.repeat(140)}))}),/large/);
});

test('revision equality ignores JSON key order but immutable identity metadata cannot change', () => {
  const first = row();
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(mergeEntries([first, reordered]).entries.length, 1);
  const next = reviseEntry({title:'edited'}, first, {now:now+1});
  assert.throws(() => mergeEntries([first, {...next,bucket:'2026-08'}]), /metadata/);
  assert.throws(() => mergeEntries([first, {...first,title:'different'}]), /same revision/);
});

test('the AM/PM selector fills in a missing suffix but never silently overrides a conflicting one', () => {
  assert.equal(parseClock('8:10', 'PM'),1210);          // selector supplies the missing meridiem
  assert.equal(parseClock('8:10 PM', 'PM'),1210);       // selector agrees with the typed suffix
  assert.throws(() => parseClock('8:10 AM', 'PM'), /disagree/);
  assert.throws(() => parseClock('8:10 PM', 'AM'), /disagree/);
});
test('DST repeated times sort by displayed clock time first, then instant, and both show offsets in Markdown', () => {
  const make = startedAt => reviseEntry({title:'활동',timeZone:zone,startedAt},null,{now});
  const first=make('2025-11-02T01:50:00-05:00'),second=make('2025-11-02T01:10:00-06:00');
  // Plan §8: displayed start time is the primary key, so 01:10 lists before 01:50
  // even though 01:10 CST is the later instant. Both offsets stay visible.
  const md=timelineMarkdown([first,second],'2025-11-02');
  assert.ok(md.indexOf('01:10 AM')<md.indexOf('01:50 AM'));
  assert.match(md,/UTC-05:00/);assert.match(md,/UTC-06:00/);
  // Same displayed minute still falls through to the absolute instant: CDT before CST.
  const dupA=make('2025-11-02T01:30:00-05:00'),dupB=make('2025-11-02T01:30:00-06:00');
  const dupMd=timelineMarkdown([dupB,dupA],'2025-11-02');
  assert.ok(dupMd.indexOf('UTC-05:00')<dupMd.indexOf('UTC-06:00'));
});
