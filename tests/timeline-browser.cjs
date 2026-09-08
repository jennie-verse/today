const {chromium,webkit}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
const browser=await chromium.launch({headless:true});
const contexts=[],errors=[],checks=[];
async function pageFor(name){const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Chicago',serviceWorkers:'block'});contexts.push(ctx);const p=await ctx.newPage();p.on('pageerror',e=>errors.push(name+': '+e.message));await p.goto((process.env.TODAY_TEST_URL || 'http://127.0.0.1:8837/today/'));await p.getByRole('button',{name:'Timeline',exact:true}).waitFor();return p;}
const a=await pageFor('A'),b=await pageFor('B');
const result=await a.evaluate(async()=>{
 const s=await import('./src/timeline-store.js'),t=await import('./src/timeline-time.js'),m=await import('./src/timeline-model.js'),d=await import('./src/data-transfer.js'),store=await import('./src/store.js'),backup=await import('./src/backup.js');
 const assert=(v,message)=>{if(!v)throw Error(message)};const checks=[];
 const base=await s.saveEntry({title:'',startedAt:t.wallToIso('2026-09-07',490,'America/Chicago'),timeZone:'America/Chicago'});
 const finish=await s.saveEntry({...base,title:'샤워',endedAt:t.wallToIso('2026-09-07',510,'America/Chicago')},{expectedRevision:base.revisionId});
 assert(finish.id===base.id&&finish.createdAt===base.createdAt,'identity changed');checks.push('start-only to interval, same identity');
 try{await s.saveEntry({...base,title:'stale'},{expectedRevision:base.revisionId});throw Error('stale accepted')}catch(e){assert(e.message.includes('changed'),'stale check failed')};checks.push('stale tab rejected');
 const before=JSON.stringify((await s.readSnapshot()).timelineEntries);
 try{await s.atomicData(s.TIMELINE_STORES,()=>({writes:{timelineEntries:[finish,{title:'bad key'}]}}));throw Error('bad write committed')}catch(e){}
 assert(JSON.stringify((await s.readSnapshot()).timelineEntries)===before,'transaction partially committed');checks.push('transaction abort leaves data intact');
 const original=IDBObjectStore.prototype.put;let injected=false;
 IDBObjectStore.prototype.put=function(...args){const req=original.apply(this,args);if(this.name==='timelineEntries'&&!injected){injected=true;req.addEventListener('success',()=>this.transaction.abort());}return req;};
 let failed=false;try{await s.saveEntry({...finish,title:'must not persist'},{expectedRevision:finish.revisionId})}catch{failed=true}finally{IDBObjectStore.prototype.put=original;}
 assert(failed&&JSON.stringify((await s.readSnapshot()).timelineEntries)===before,'abort after request success lost records');checks.push('abort after request success rejects');
 const v1={format:'today-backup',version:1,tasks:[],journalActivity:[]};await d.restoreData(v1,{replace:true});assert((await s.readSnapshot()).timelineEntries.length===1,'v1 erased timeline');checks.push('v1 replace preserves timeline');
 const exported=await d.exportData();assert(backup.validatePayload(exported)===null,'invalid export');
 const removed=await s.saveEntry({...finish,deletedAt:new Date().toISOString()},{expectedRevision:finish.revisionId});
 const restored=await d.restoreData(exported,{replace:true});let live=(await s.readSnapshot()).timelineEntries.filter(r=>!r.deletedAt);assert(live.length===1&&live[0].title==='샤워','v2 restore failed');checks.push('v2 restore resurrects as a new revision');
 const running=await s.saveEntry({title:'one',timeZone:'America/Chicago',isRunning:true});
 let requiresSwitch=false;try{await s.saveEntry({title:'two',timeZone:'America/Chicago',isRunning:true})}catch(e){requiresSwitch=!!e.running};assert(requiresSwitch,'running automatically switched');
 await s.saveEntry({title:'two',timeZone:'America/Chicago',isRunning:true},{switchCurrent:true});const entries=(await s.readSnapshot()).timelineEntries;assert(entries.filter(r=>r.isRunning).length===1,'multiple current after switch');assert(entries.find(r=>r.id===running.id).endedAt,'old current not ended');checks.push('explicit atomic current switch');
 const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,val){if(key==='today.journalActivity.v1')throw new DOMException('Blocked','QuotaExceededError');return originalSet.call(this,key,val)};
 const pending=await d.restoreData(exported,{replace:true});assert(pending.pending,'restore did not flag pending legacy history');Storage.prototype.setItem=originalSet;
 await d.recoverRestore();assert(!(await s.readSnapshot()).timelineMeta.some(r=>r.key==='restorePending'),'restore recovery left pending');checks.push('legacy history failure and recovery');
 return checks;
});checks.push(...result);
const remote=new Map();let seq=0,conflictOnce=false,writeHook=null;
async function apiCall({method,args}){
 if(method==='listDir'){const prefix=args[1]+'/';const out=new Map();for(const [path,file] of remote){if(!path.startsWith(prefix))continue;const rest=path.slice(prefix.length),name=rest.split('/')[0];out.set(name,{name,path:prefix+name,type:rest.includes('/')?'dir':'file',sha:file.sha});}return [...out.values()];}
 if(method==='readFile'){const file=remote.get(args[1]);return file?{exists:true,...file}:{exists:false};}
 if(method==='writeFile'){if(conflictOnce){conflictOnce=false;return {__error:'conflict'}}const old=remote.get(args[1]);if((old?.sha||undefined)!==args[3]?.sha)return {__error:'conflict'};if(writeHook){const hook=writeHook;writeHook=null;await hook();}const file={content:args[2],sha:String(++seq)};remote.set(args[1],file);return file;}
 throw Error(method);
}
for(const p of [a,b]) await p.exposeFunction('qaSyncAPI',apiCall);
async function syncPage(p,context){return p.evaluate(async(context)=>{const mod=await import('./src/timeline-sync.js');const api=Object.fromEntries(['listDir','readFile','writeFile'].map(method=>[method,async(...args)=>{const r=await window.qaSyncAPI({method,args});if(r?.__error)throw Object.assign(new Error(r.__error),{type:r.__error});return r;}]));const r=await mod.runTimelineSync({api,ready:()=>true,config:()=>({}),context:()=>context});return {pulled:r.pulled,error:r.error?.message};},context);}
assert.equal((await syncPage(a,'alpha')).error,undefined);assert.equal((await syncPage(b,'beta')).error,undefined);
let id=await b.evaluate(async()=>{const s=await import('./src/timeline-store.js');const r=(await s.readSnapshot()).timelineEntries.find(r=>!r.deletedAt);await s.saveEntry({...r,title:'B edited end',endedAt:'2026-09-07T08:45:00-05:00'},{expectedRevision:r.revisionId});return r.id;});
assert.equal((await syncPage(b,'beta')).error,undefined);assert.equal((await syncPage(a,'alpha')).error,undefined);
assert.equal(await a.evaluate(async id=>(await (await import('./src/timeline-store.js')).readSnapshot()).timelineEntries.find(r=>r.id===id).endedAt,id),'2026-09-07T08:45:00-05:00');checks.push('two-device end edit converges without duplicate');
await a.evaluate(async id=>{const s=await import('./src/timeline-store.js'),r=(await s.readSnapshot()).timelineEntries.find(r=>r.id===id);await s.saveEntry({...r,title:'A name'},{expectedRevision:r.revisionId});},id);
await b.evaluate(async id=>{const s=await import('./src/timeline-store.js'),r=(await s.readSnapshot()).timelineEntries.find(r=>r.id===id);await s.saveEntry({...r,endedAt:'2026-09-07T08:50:00-05:00'},{expectedRevision:r.revisionId});},id);
assert.equal((await syncPage(a,'alpha')).error,undefined);assert.equal((await syncPage(b,'beta')).error,undefined);assert.equal((await syncPage(a,'alpha')).error,undefined);
assert.equal(await a.evaluate(async()=>(await (await import('./src/timeline-store.js')).readSnapshot()).timelineConflicts.length),1);checks.push('two-device concurrent changes retained');
await a.evaluate(async id=>{const s=await import('./src/timeline-store.js'),r=(await s.readSnapshot()).timelineEntries.find(r=>r.id===id);await s.saveEntry({...r,title:'combined',endedAt:'2026-09-07T08:50:00-05:00'},{expectedRevision:r.revisionId,resolve:true});},id);
conflictOnce=true;assert.equal((await syncPage(a,'alpha')).error,undefined);assert.equal((await syncPage(b,'beta')).error,undefined);
assert.equal(await b.evaluate(async()=>(await (await import('./src/timeline-store.js')).readSnapshot()).timelineConflicts.length),0);checks.push('resolved conflicts stay resolved; SHA retry');
await a.evaluate(async id=>{const s=await import('./src/timeline-store.js'),r=(await s.readSnapshot()).timelineEntries.find(r=>r.id===id);await s.saveEntry({...r,title:'before upload'},{expectedRevision:r.revisionId});},id);
writeHook=()=>a.evaluate(async id=>{const s=await import('./src/timeline-store.js'),r=(await s.readSnapshot()).timelineEntries.find(r=>r.id===id);await s.saveEntry({...r,title:'during upload'},{expectedRevision:r.revisionId});},id);
assert.equal((await syncPage(a,'alpha')).error,undefined);
assert.ok(await a.evaluate(async()=>(await (await import('./src/timeline-store.js')).readSnapshot()).timelineMeta.some(r=>r.key.startsWith('dirty:'))));
assert.equal((await syncPage(a,'alpha')).error,undefined);assert.equal((await syncPage(b,'beta')).error,undefined);
assert.equal(await b.evaluate(async id=>(await (await import('./src/timeline-store.js')).readSnapshot()).timelineEntries.find(r=>r.id===id).title,id),'during upload');checks.push('edits during upload stay pending then converge');
const old=remote.get('today/timeline/2026-09/data.beta.json');remote.set('today/timeline/2026-09/data.beta.json',{content:'broken',sha:String(++seq)});assert.ok((await syncPage(a,'alpha')).error);remote.set('today/timeline/2026-09/data.beta.json',old);checks.push('corrupt remote file not overwritten');
// UI deletion, removal/readdition of the end time, and conflict resolution surfaces.
await a.getByRole('button',{name:'Timeline',exact:true}).click();await a.getByLabel('Timeline date').fill('2026-09-07');await a.getByRole('button',{name:'List',exact:true}).click();
await a.locator('.timeline-record-main').first().click();await a.getByRole('button',{name:'Remove end time',exact:true}).click();await a.getByRole('button',{name:'Save activity',exact:true}).click();await a.getByRole('button',{name:'Add end time',exact:true}).first().waitFor();checks.push('UI remove end returns to time-only record');
await a.locator('#timeline-input').fill('8:10 pm 티비');await a.getByRole('button',{name:'Save',exact:true}).click();await a.waitForFunction(()=>document.querySelector('.timeline-list')?.textContent.includes('08:10 PM'));checks.push('UI spaced lowercase PM');
for(const size of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]){
 await a.setViewportSize(size);
 for(const font of [6,8,10,12,14,17]){await a.evaluate(font=>document.documentElement.style.setProperty('--f',`${font}px`),font);await a.getByRole('button',{name:'List',exact:true}).click();const overflow=await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,JSON.stringify({size,font}));}
 await a.evaluate(()=>document.documentElement.style.setProperty('--f','12px'));
 await a.screenshot({path:`/tmp/today-timeline-${size.width}x${size.height}.png`});
}checks.push('four viewports × six font sizes without page overflow');
assert.deepEqual(errors,[]);await browser.close();
console.log(JSON.stringify({checks,consoleErrors:errors,webkitAvailable:fs.existsSync(webkit.executablePath())},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
