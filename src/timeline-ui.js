import { getSettings, setSettings } from './store.js';
import { readDay, saveEntry, onTimelineChange, readSnapshot, cleanEntry } from './timeline-store.js';
import { sortEntries, dayEntries } from './timeline-model.js';
import { parseQuick, parseClock, dateInZone, zoneNow, isoAt, formatClock, shiftDate, wallToIso, minutesOf, simpleDay } from './timeline-time.js';
import { timelineMarkdown, timeLabel } from './timeline-markdown.js';
import { toast, undoToast, confirmDialog } from './ui.js';
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
function button(label, action, cls = 'btn') {
  const node = el('button', cls, label); node.type = 'button';
  node.addEventListener('click', async () => {
    if (node.disabled) return;
    node.disabled = true;
    try { await action(); } catch (error) { toast(error.message || 'Could not save. Please try again.'); }
    finally { if (node.dataset.managedDisabled !== 'true') node.disabled = false; }
  });
  return node;
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function dialog(title) {
  const previous = document.activeElement, box = el('dialog', 'timeline-dialog');
  const heading = el('h2', '', title), body = el('div', 'timeline-dialog-body'), foot = el('div', 'timeline-dialog-foot');
  heading.id = `dialog-${crypto.randomUUID()}`; box.setAttribute('aria-labelledby', heading.id);
  box.append(heading, body, foot); document.body.append(box);
  box.addEventListener('cancel', event => { if (event.isComposing || box.dataset.busy === 'true') event.preventDefault(); });
  box.addEventListener('keydown', event => { if (event.key === 'Escape' && (event.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } });
  box.addEventListener('close', () => { box.remove(); previous?.focus(); }, { once: true });
  return { box, body, foot, close: () => box.close() };
}
export async function initTimeline({ onTasksVisible = () => {} } = {}) {
  const app = document.querySelector('.app'), tasks = el('div', 'tasks-panel'); tasks.id = 'tasks-panel';
  tasks.append(document.getElementById('body-scroll'), document.querySelector('.add-wrap')); app.append(tasks);
  const tabs = el('nav', 'today-tabs'); tabs.setAttribute('aria-label', 'Today views');
  const panel = el('section', 'timeline-panel'); panel.id = 'timeline-panel'; panel.hidden = true;
  const state = { date: dateInZone(), entries: [], conflicts: [], view: getSettings().timelineView || 'timetable', tab: 'tasks', revision: 0 };
  const header = el('div', 'timeline-toolbar');
  const date = el('input', 'timeline-date'); date.type = 'date'; date.value = state.date; date.max = dateInZone(); date.setAttribute('aria-label', 'Timeline date');
  const today = button('Today', () => changeDate(dateInZone()), 'btn ghost');
  header.append(button('‹', () => changeDate(shiftDate(state.date, -1)), 'ico'), date, button('›', () => changeDate(shiftDate(state.date, 1)), 'ico'), today);
  header.firstChild.setAttribute('aria-label', 'Previous day'); header.children[2].setAttribute('aria-label', 'Next day');
  date.addEventListener('change', () => { if (date.value) changeDate(date.value); });
  const current = el('div', 'timeline-current');
  const toolbar = el('div', 'timeline-viewbar');
  const timetable = button('Timetable', () => setView('timetable'), 'chip');
  const list = button('List', () => setView('list'), 'chip');
  const exportBtn = button('Export', () => openExport(), 'btn ghost');
  toolbar.append(timetable, list, exportBtn);
  const message = el('p', 'timeline-status hint'); message.setAttribute('role', 'status');
  const content = el('div', 'timeline-content');
  const composer = el('form', 'timeline-composer');
  const label = el('label', '', 'Activity / time'); label.htmlFor = 'timeline-input';
  const input = el('input'); input.id = 'timeline-input'; input.placeholder = '8:10am 샤워 · or just an activity'; input.autocomplete = 'off';
  const actions = el('div', 'timeline-actions');
  const save = button('Save', () => quick(false), 'btn primary');
  const start = button('Start', () => quick(true), 'btn');
  save.dataset.managedDisabled = start.dataset.managedDisabled = 'true';
  const details = button('Add details', () => {
    let parsed;
    try { parsed = input.value.trim() ? parseQuick(input.value) : null; } catch { /* retain raw text in time field below */ }
    const draft = { title: parsed?.title ?? '', startText: parsed?.startMinutes != null ? formatClock(parsed.startMinutes) : (input.value.match(/^\d{1,2}:\d{2}/)?.[0] || ''), endText: parsed?.endMinutes != null ? formatClock(parsed.endMinutes) : '' };
    openEditor(null, { draft });
  }, 'btn ghost');
  const hint = el('p', 'hint', 'Save a time now. Add an end time whenever you like. Start marks your current activity.');
  const inputError = el('p', 'timeline-error'); inputError.setAttribute('role', 'alert');
  actions.append(save, start, details); composer.append(label, input, actions, inputError, hint);
  let composing = false, saving = false;
  input.addEventListener('compositionstart', () => { composing = true; }); input.addEventListener('compositionend', () => { composing = false; enableInput(); });
  input.addEventListener('input', () => { inputError.textContent = ''; enableInput(); });
  composer.addEventListener('submit', event => { event.preventDefault(); if (!composing && !saving) quick(false); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!composing && !event.isComposing && event.keyCode !== 229) quick(false); } });
  panel.append(header, current, toolbar, message, content, composer);
  const taskTab = button('Tasks', () => setTab('tasks'), 'today-tab');
  const timelineTab = button('Timeline', () => setTab('timeline'), 'today-tab');
  taskTab.setAttribute('aria-controls', tasks.id); timelineTab.setAttribute('aria-controls', panel.id);
  tabs.append(taskTab, timelineTab); app.insertBefore(tabs, tasks); app.append(panel);
  function setTab(tab) {
    state.tab = tab; tasks.hidden = tab !== 'tasks'; panel.hidden = tab !== 'timeline';
    taskTab.setAttribute('aria-current', tab === 'tasks' ? 'page' : 'false'); timelineTab.setAttribute('aria-current', tab === 'timeline' ? 'page' : 'false');
    setSettings({ lastTab: tab }); if (tab === 'tasks') onTasksVisible(); else refresh();
  }
  function setView(view) { state.view = view; setSettings({ timelineView: view }); render(); }
  // anchor = true only when the user moved to this date on purpose (date controls,
  // Today, first load); tab / view round-trips keep the scroll position.
  function changeDate(value) { state.date = value; date.value = value; refresh(true); enableInput(); }
  function enableInput() {
    const onToday = state.date === dateInZone();
    save.disabled = saving || composing || !input.value.trim();
    start.hidden = !onToday; start.disabled = save.disabled || !onToday;
  }
  async function quick(running) {
    if (saving || composing) return;
    saving = true; enableInput(); const raw = input.value, selectedDate = state.date, now = Date.now(), zone = zoneNow();
    try {
      const parsed = parseQuick(raw);
      const onToday = selectedDate === dateInZone(now);
      if (parsed.startMinutes === null && !onToday) throw new Error(selectedDate > dateInZone(now) ? 'That date is in the future. Record it once it happens, or add a time.' : 'Add a time when recording a past day.');
      if (running && !onToday) throw new Error('Use Save for past activities.');
      if (running && parsed.endMinutes !== null) throw new Error('Use Save for an activity with an end time.');
      let startedAt, endedAt;
      try {
        startedAt = parsed.startMinutes === null ? isoAt(now, zone) : wallToIso(selectedDate, parsed.startMinutes, zone);
        endedAt = parsed.endMinutes === null ? null : wallToIso(selectedDate, parsed.endMinutes, zone);
      } catch (error) {
        if (!error.options) throw error;
        // Repeated wall-clock hour on a DST fall-back day: let the editor pick the offset.
        openEditor(null, { draft: { title: parsed.title, startText: parsed.startMinutes != null ? formatClock(parsed.startMinutes) : '', endText: parsed.endMinutes != null ? formatClock(parsed.endMinutes) : '' } });
        throw new Error('This time occurs twice today. Pick the UTC offset in Add details.');
      }
      if (parsed.endMinutes !== null && parsed.endMinutes < minutesOf(startedAt)) {
        openEditor(null, { draft: { title: parsed.title, startText: formatClock(startedAt), endText: formatClock(parsed.endMinutes) } });
        throw new Error('Choose Next day in Add details if this activity crosses midnight.');
      }
      const draft = { title: parsed.title, startedAt, endedAt, timeZone: zone, isRunning: running };
      try { await saveEntry(draft, { now }); }
      catch (error) {
        if (!error.running) throw error;
        const ok = await confirmDialog({ title: 'Switch current activity?', message: `End ${error.running.length} current activity at ${formatClock(startedAt)} and start this one?`, confirmLabel: 'End current and start' });
        if (!ok) return;
        await saveEntry(draft, { now, switchCurrent: true });
      }
      if (input.value === raw) input.value = '';
      inputError.textContent = ''; toast(running ? 'Activity started' : 'Time saved');
      await refresh();
    } catch (error) { inputError.textContent = error.message; }
    finally { saving = false; enableInput(); }
  }
  async function refresh(anchor = false) {
    const rev = ++state.revision;
    try {
      const data = await readDay(state.date);
      if (rev !== state.revision) return;
      state.entries = data.entries; state.conflicts = data.conflicts; render(anchor);
    } catch (error) { message.textContent = error.message; }
  }
  // Keep keyboard / VoiceOver focus on the row the user just acted on (Plan §U03);
  // render() has already replaced every card, so re-find it by id.
  function focusRecord(id) {
    const target = id && content.querySelector(`[data-entry-id="${CSS.escape(id)}"] .timeline-record-main`);
    (target || input).focus();
  }
  function recordCard(record, continued = false) {
    const card = el('article', `timeline-record${record.isRunning ? ' is-current' : ''}`); card.dataset.entryId = record.id;
    const edit = button('', () => openEditor(record), 'timeline-record-main');
    edit.append(el('span', 'timeline-time', timeLabel(record, { offsets: true })), el('span', record.title ? 'timeline-title' : 'timeline-title muted', record.title || 'No activity name'));
    // Offsets are visible only in details and exceptional days; keep everyday rows compact.
    edit.firstChild.textContent = timeLabel(record, { offsets: !simpleDay(state.date, state.entries.filter(r => r.startDate === state.date)) });
    if (record.isRunning) edit.append(el('span', 'timeline-badge', 'Ongoing'));
    if (continued) edit.append(el('span', 'hint', `Continued from ${record.startDate}`));
    card.append(edit);
    if (!record.endedAt) card.append(button('Add end time', () => openEditor(record, { focusEnd: true }), 'btn ghost timeline-add-end'));
    return card;
  }
  function render(anchor = false) {
    const oldScroll = content.scrollTop;
    timetable.setAttribute('aria-pressed', String(state.view === 'timetable')); list.setAttribute('aria-pressed', String(state.view === 'list'));
    const running = state.entries.filter(r => r.isRunning && !r.deletedAt);
    current.replaceChildren(); current.hidden = !running.length;
    if (running.length) current.append(el('p', 'timeline-eyebrow', running.length > 1 ? 'Review current activities' : 'Current activity'));
    for (const row of running) {
      const line = el('div', 'timeline-current-line');
      const text = el('div'); text.append(el('strong', '', row.title || 'No activity name'), el('span', 'hint', `${row.startDate} · ${formatClock(row.startedAt)}`));
      line.append(text, button('End now', async () => { await saveEntry({ ...row, endedAt: isoAt(Date.now(), row.timeZone), isRunning: false }, { expectedRevision: row.revisionId }); toast('End time saved'); }), button('Edit', () => openEditor(row), 'btn ghost')); current.append(line);
    }
    const rows = dayEntries(state.entries, state.date);
    const continued = state.entries.filter(r => r.startDate < state.date && (r.endedAt ? r.endedAt.slice(0, 19) > `${state.date}T00:00:00` : r.isRunning));
    const all = [...rows, ...continued];
    content.replaceChildren(); message.replaceChildren();
    if (state.conflicts.length) message.append(button(`Review alternate versions (${state.conflicts.length})`, openConflicts, 'btn ghost'));
    exportBtn.disabled = !rows.length;
    if (!all.length) {
      const empty = el('div', 'timeline-empty'); empty.append(el('span', 'timeline-empty-clock', '◷'), el('h2', '', 'Your day, as it happens'), el('p', '', 'Write an activity or a time below.'), el('p', 'hint', 'An end time can always be added later.')); content.append(empty);
    } else if (state.view === 'list' || !simpleDay(state.date, all)) {
      if (state.view !== 'list') message.append(el('span', '', 'List is shown for this day because its time zone changes.'));
      const stack = el('div', 'timeline-list'); rows.forEach(r => stack.append(recordCard(r)));
      if (continued.length) { stack.append(el('p', 'timeline-eyebrow', 'Continued from earlier days · exported on the start date')); continued.forEach(r => stack.append(recordCard(r, true))); }
      content.append(stack);
    } else {
      const grid = el('div', 'timeline-grid');
      for (let h = 0; h <= 24; h++) {
        const tick = el('div', 'timeline-hour'); tick.style.top = `${h * 60}px`; tick.append(el('span', '', h === 24 ? '12:00 AM' : formatClock(h * 60))); grid.append(tick);
      }
      const sorted = [...all].sort((a, b) => (a.startDate < state.date ? 0 : minutesOf(a.startedAt)) - (b.startDate < state.date ? 0 : minutesOf(b.startedAt)));
      let labelBottom = -10; const lanes = [];
      for (const row of sorted) {
        const from = row.startDate < state.date ? 0 : minutesOf(row.startedAt);
        const endIso = row.endedAt || (row.isRunning ? isoAt(Date.now(), row.timeZone) : row.startedAt);
        const to = endIso.slice(0, 10) > state.date ? 1440 : Math.max(from, minutesOf(endIso));
        let lane = lanes.findIndex(end => end <= from); if (lane < 0) lane = lanes.length; lanes[lane] = Math.max(to, from + 1);
        const mark = el('div', `timeline-mark${row.endedAt || row.isRunning ? ' interval' : ''}${row.isRunning ? ' running' : ''}`);
        mark.dataset.entryId = row.id; mark.dataset.from = String(from); mark.style.top = `${from}px`; mark.style.height = `${Math.max(3, to - from)}px`; mark.style.left = `${79 + lane % 4 * 8}px`; mark.title = timeLabel(row); grid.append(mark);
        const card = recordCard(row, row.startDate < state.date); const top = Math.max(from, labelBottom + 8); card.style.top = `${top}px`; grid.append(card); labelBottom = top + (row.endedAt ? 70 : 110);
      }
      grid.style.height = `${Math.max(1500, labelBottom + 25)}px`; content.append(grid);
      let bottom = -8;
      grid.querySelectorAll('.timeline-record').forEach(card => {
        const top = Math.max(parseFloat(card.style.top), bottom + 8); card.style.top = `${top}px`;
        bottom = top + (card.getBoundingClientRect().height || 110);
      });
      grid.style.height = `${Math.max(1500, bottom + 25)}px`;
      if (lanes.length > 4) {
        const stack = el('div', 'timeline-list'); sorted.forEach(r => stack.append(recordCard(r, r.startDate < state.date))); content.replaceChildren(stack);
        message.append(el('span', '', 'List is shown so all overlapping activities remain readable.'));
      }
    }
    content.scrollTop = anchor && state.view === 'timetable' && simpleDay(state.date, all) && all.length
      ? Math.max(0, (state.date === dateInZone() ? minutesOf(isoAt()) : Math.min(...all.map(r => r.startDate < state.date ? 0 : minutesOf(r.startedAt)))) - 80) : oldScroll;
    enableInput();
  }
  function openEditor(entry, { draft = {}, focusEnd = false, resolving = false } = {}) {
    const modal = dialog(resolving ? 'Resolve alternate version' : entry ? 'Edit activity' : 'Add activity');
    const zone = entry?.timeZone || zoneNow(); const now = isoAt(Date.now(), zone);
    const fields = {};
    function field(name, labelText, value, type = 'text') {
      const wrap = el('label', 'timeline-field', labelText); const input = el('input'); input.type = type; input.value = value; input.autocomplete = 'off'; input.setAttribute('aria-label', labelText); wrap.append(input); fields[name] = input; return wrap;
    }
    modal.body.append(field('title', 'Activity (optional)', draft.title ?? entry?.title ?? ''));
    const startRow = el('div', 'timeline-fields'); startRow.append(field('startDate', 'Start date', draft.startDate || entry?.startDate || state.date, 'date'), field('startTime', 'Start time', draft.startText || (entry ? formatClock(entry.startedAt) : formatClock(now))));
    const endRow = el('div', 'timeline-fields'); endRow.append(field('endDate', 'End date', draft.endDate || entry?.endDate || entry?.startDate || state.date, 'date'), field('endTime', 'End time (optional)', draft.endText ?? (entry?.endedAt ? formatClock(entry.endedAt) : '')));
    const timeOptions = el('div', 'timeline-fields');
    function period(label, key) { const wrap = el('label', 'timeline-field', label); const select = el('select'); select.setAttribute('aria-label', label); for (const v of ['', 'AM', 'PM']) { const opt = el('option', '', v || 'In the time above'); opt.value = v; select.append(opt); } fields[key] = select; select.addEventListener('change', () => { const time = fields[key === 'startPeriod' ? 'startTime' : 'endTime']; if (select.value && /(?:am|pm)$/i.test(time.value.trim())) time.value = time.value.trim().replace(/(?:am|pm)$/i, select.value); }); wrap.append(select); return wrap; }
    timeOptions.append(period('Start AM/PM', 'startPeriod'), period('End AM/PM', 'endPeriod'));
    const currentLabel = el('label', 'timeline-check'); const isRunning = el('input'); isRunning.type = 'checkbox'; isRunning.checked = draft.isRunning ?? entry?.isRunning ?? false; currentLabel.append(isRunning, el('span', '', 'Current activity (no end time)'));
    const shortcuts = el('div', 'timeline-actions');
    shortcuts.append(button('Next day', () => { fields.endDate.value = shiftDate(fields.startDate.value, 1); }), button('Remove end time', () => { fields.endTime.value = ''; isRunning.checked = false; }));
    if (entry?.isRunning) shortcuts.append(button('Clear current status', () => { isRunning.checked = false; }));
    const error = el('p', 'timeline-error'); error.setAttribute('role', 'alert');
    const offsets = el('div', 'timeline-fields'); const choices = {};
    modal.body.append(startRow, endRow, timeOptions, shortcuts, currentLabel, el('p', 'hint', `Time zone: ${zone}. Leave the end blank to add it later.`), offsets, error);
    let busy = false, composing = false;
    modal.box.addEventListener('compositionstart', () => { composing = true; }); modal.box.addEventListener('compositionend', () => { composing = false; });
    function resolveWall(key) {
      const date = fields[`${key}Date`].value, minutes = parseClock(fields[`${key}Time`].value, fields[`${key}Period`].value);
      const original = key === 'start' ? entry?.startedAt : entry?.endedAt;
      try { return wallToIso(date, minutes, zone, choices[key]?.value || (original?.slice(0, 10) === date && minutesOf(original) === minutes ? original.slice(-6) : '')); }
      catch (e) {
        if (e.options) {
          choices[key]?.parentElement.remove(); const wrap = el('label', 'timeline-field', `${key} UTC offset`); const select = el('select'); const empty = el('option', '', 'Choose occurrence'); empty.value = ''; select.append(empty);
          for (const iso of e.options) { const option = el('option', '', `UTC${iso.slice(-6)}`); option.value = iso.slice(-6); select.append(option); } wrap.append(select); offsets.append(wrap); choices[key] = select;
        }
        throw e;
      }
    }
    const switchButton = button('End current and start', () => submit(true), 'btn'); switchButton.hidden = true;
    const saveButton = button('Save activity', () => submit(false), 'btn primary');
    async function submit(switchCurrent) {
      if (busy || composing) return; busy = true; modal.box.dataset.busy = 'true'; error.textContent = '';
      try {
        const start = resolveWall('start'), end = fields.endTime.value.trim() ? resolveWall('end') : null;
        const saved = await saveEntry({ ...entry, title: fields.title.value, startedAt: start, endedAt: end, timeZone: zone, isRunning: !end && isRunning.checked, deletedAt: null }, { expectedRevision: entry?.revisionId || null, switchCurrent, resolve: resolving });
        modal.close(); toast(entry ? 'Activity updated' : 'Activity saved'); await refresh();
        focusRecord(saved?.id);
      } catch (e) { error.textContent = e.running ? 'Another activity is current. Use End current and start to switch at the start time above, or cancel.' : e.message; switchButton.hidden = !e.running; }
      finally { busy = false; modal.box.dataset.busy = 'false'; }
    }
    modal.foot.append(button('Cancel', () => { if (!busy) modal.close(); }, 'btn ghost'), switchButton, saveButton);
    if (entry) modal.foot.prepend(button('Delete', async () => {
      if (busy || composing) return; busy = true; modal.box.dataset.busy = 'true';
      try {
      const deleted = await saveEntry({ ...entry, deletedAt: new Date().toISOString(), isRunning: false }, { expectedRevision: entry.revisionId, allowFuture: true, resolve: resolving });
      modal.close(); await refresh(); input.focus();
      undoToast('Activity deleted', { onUndo: async () => { try { await saveEntry({ ...entry, deletedAt: null }, { expectedRevision: deleted.revisionId, allowFuture: true }); await refresh(); focusRecord(entry.id); } catch (e) { toast(e.message); } } });
      } catch (e) { error.textContent = e.message; }
      finally { busy = false; modal.box.dataset.busy = 'false'; }
    }, 'btn danger'));
    modal.box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !composing && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(false); } });
    modal.box.showModal(); (focusEnd ? fields.endTime : fields.title).focus();
  }
  async function openConflicts() {
    const data = await readSnapshot(); const modal = dialog('Review alternate versions');
    modal.body.append(el('p', 'hint', 'Both versions are kept. Choose values, edit if needed, then save to resolve.'));
    for (const alternate of data.timelineConflicts) {
      const current = data.timelineEntries.map(cleanEntry).find(r => r.id === alternate.id);
      if (!current) continue;
      const group = el('section', 'timeline-conflict');
      for (const [label, record] of [['Current version', current], ['Alternate version', alternate]]) {
        group.append(el('p', '', `${label}: ${record.deletedAt ? 'Deleted · ' : ''}${record.title || 'No activity name'} · ${timeLabel(record)}`));
        group.append(button(`Use ${label.toLowerCase()}`, async () => {
          if (record.deletedAt) { await saveEntry({ ...current, deletedAt: new Date().toISOString() }, { expectedRevision: current.revisionId, resolve: true, allowFuture: true }); modal.close(); }
          else { modal.close(); openEditor(current, { resolving: true, draft: { title: record.title, startDate: record.startDate, startText: formatClock(record.startedAt), endDate: record.endDate || record.startDate, endText: record.endedAt ? formatClock(record.endedAt) : '', isRunning: record.isRunning } }); }
        }));
      }
      modal.body.append(group);
    }
    modal.foot.append(button('Close', modal.close, 'btn ghost')); modal.box.showModal();
  }
  async function openExport() {
    const exportDate = state.date, modal = dialog('Export Markdown');
    const preview = el('textarea', 'timeline-markdown'); preview.readOnly = true; preview.setAttribute('aria-label', 'Markdown preview');
    const note = el('p', 'hint');
    const status = el('p', 'timeline-status hint'); status.setAttribute('role', 'status'); status.hidden = true;
    // §9: preview states the ongoing count and the no-end explanation separately,
    // and is recomputed whenever the day changes underneath it.
    const paint = entries => {
      const rows = dayEntries(entries, exportDate);
      const ongoing = rows.filter(r => r.isRunning).length;
      const continued = entries.filter(r => r.startDate < exportDate && (r.endedAt ? r.endedAt.slice(0, 19) > `${exportDate}T00:00:00` : r.isRunning)).length;
      preview.value = timelineMarkdown(entries, exportDate);
      note.textContent = `${exportDate} · ${rows.length} record${rows.length === 1 ? '' : 's'}`
        + (ongoing ? ` · ${ongoing} ongoing (start time only, no end)` : '')
        + (continued ? ' · continuations are exported on their start date' : '');
    };
    paint((await readDay(exportDate)).entries);
    modal.body.append(note, preview, status);
    modal.foot.append(button('Close', modal.close, 'btn ghost'), button('Copy Markdown', async () => { try { await navigator.clipboard.writeText(preview.value); toast('Markdown copied'); } catch { preview.focus(); preview.select(); status.hidden = false; status.textContent = 'Select and copy the text above. Clipboard access was unavailable.'; } }), button('Download .md', () => download(preview.value, `today-timeline-${exportDate}.md`, 'text/markdown;charset=utf-8'), 'btn primary'));
    const unsubscribe = onTimelineChange(async () => {
      try { const fresh = await readDay(exportDate); paint(fresh.entries); status.hidden = true; }
      catch { status.hidden = false; status.textContent = 'Could not refresh the preview. Close and open Export again.'; }
    }); modal.box.addEventListener('close', unsubscribe, { once: true }); modal.box.showModal();
  }
  onTimelineChange(() => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  const tick = () => {
    if (!document.hidden && state.tab === 'timeline') {
      for (const r of state.entries.filter(r => r.isRunning)) {
        const mark = [...content.querySelectorAll('.timeline-mark')].find(node => node.dataset.entryId === r.id);
        if (mark) { const now = isoAt(Date.now(), r.timeZone); const end = now.slice(0, 10) > state.date ? 1440 : minutesOf(now); mark.style.height = `${Math.max(3, end - Number(mark.dataset.from))}px`; }
      }
    }
    setTimeout(tick, 60000 - Date.now() % 60000 + 50);
  }; setTimeout(tick, 60000 - Date.now() % 60000 + 50);
  setTab(getSettings().lastTab === 'timeline' ? 'timeline' : 'tasks'); enableInput(); await refresh(true);
  return { refresh };
}
