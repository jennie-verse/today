import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function reqToPromise'), source.indexOf('// ---------- change hooks'));
test('a successful write request stays pending until the transaction commits', async () => {
  const context = vm.createContext({}); vm.runInContext(helper, context);
  const request = { result: 'saved', transaction: { mode: 'readwrite' } };
  let saved = false;
  const result = context.reqToPromise(request).then(value => { saved = true; return value; });
  request.onsuccess?.(); await Promise.resolve();
  assert.equal(saved, false);
  request.transaction.oncomplete();
  assert.equal(await result, 'saved');
});
test('an abort after request success rejects the write instead of notifying success', async () => {
  const context = vm.createContext({}); vm.runInContext(helper, context);
  const request = { result: 'saved', transaction: { mode: 'readwrite' } };
  const result = context.reqToPromise(request);
  request.onsuccess?.(); request.transaction.onabort();
  await assert.rejects(result, /cancelled/);
});
