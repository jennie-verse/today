// settings.js — settings sheet: font size, sync (device name/token for
// Journal), Journal toggles, backup/restore, reset.

import { FONT_STEPS, DEFAULT_SETTINGS } from "./model.js";
import * as store from "./store.js";
import { exportBackup, importBackup, pickImportFile, daysSinceBackup } from "./backup.js";
import { confirmDialog, toast } from "./ui.js";
import * as sync from "./sync.js";
import * as syncRunner from "./sync-runner.js";
import * as journal from "./journal.js";
import { APP_BUILD } from "./version.js";

function fmtWhen(ms) {
  if (!ms) return "never";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function buildSyncSection(sec) {
  const status = document.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  sec.appendChild(status);

  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Off by default. Everything works without it — sync only adds a copy of Today, Someday, and Done tasks in your private webapp-data repository so other devices (and Journal) can use them.";
  sec.appendChild(intro);

  const nameRow = document.createElement("div");
  nameRow.style.marginTop = "10px";
  const nameLbl = document.createElement("label");
  nameLbl.className = "lbl";
  nameLbl.textContent = "Device name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.autocapitalize = "none";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.placeholder = "iphone-home";
  nameInput.style.marginTop = "6px";
  nameLbl.htmlFor = nameInput.id = "sync-device-name";
  const nameHint = document.createElement("p");
  nameHint.className = "hint";
  nameHint.textContent = "English letters and numbers — the file name is built from this and cannot be changed later.";
  nameRow.append(nameLbl, nameInput, nameHint);
  sec.appendChild(nameRow);

  const tokenRow = document.createElement("div");
  tokenRow.style.marginTop = "10px";
  const tokenLbl = document.createElement("label");
  tokenLbl.className = "lbl";
  tokenLbl.textContent = "Access token";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.autocapitalize = "none";
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenInput.placeholder = "github_pat_…";
  tokenInput.style.marginTop = "6px";
  tokenLbl.htmlFor = tokenInput.id = "sync-token";
  const tokenBtns = document.createElement("div");
  tokenBtns.style.display = "flex";
  tokenBtns.style.gap = "8px";
  tokenBtns.style.marginTop = "8px";
  const saveTokenBtn = document.createElement("button");
  saveTokenBtn.type = "button"; saveTokenBtn.className = "btn"; saveTokenBtn.style.flex = "1"; saveTokenBtn.textContent = "Save token";
  const clearTokenBtn = document.createElement("button");
  clearTokenBtn.type = "button"; clearTokenBtn.className = "btn"; clearTokenBtn.style.flex = "1"; clearTokenBtn.textContent = "Clear token";
  tokenBtns.append(saveTokenBtn, clearTokenBtn);
  tokenRow.append(tokenLbl, tokenInput, tokenBtns);
  sec.appendChild(tokenRow);

  // --- enable switch ---
  const enableRow = document.createElement("div");
  enableRow.className = "settings-row";
  const enableLbl = document.createElement("div");
  enableLbl.className = "lbl";
  enableLbl.textContent = "Sync this device";
  const enableSwitch = document.createElement("button");
  enableSwitch.type = "button";
  enableSwitch.className = "switch";
  enableSwitch.setAttribute("role", "switch");
  enableRow.append(enableLbl, enableSwitch);
  sec.appendChild(enableRow);

  const syncNowBtn = document.createElement("button");
  syncNowBtn.type = "button";
  syncNowBtn.className = "btn";
  syncNowBtn.style.marginTop = "8px";
  syncNowBtn.style.width = "100%";
  syncNowBtn.textContent = "Sync now";
  sec.appendChild(syncNowBtn);

  function refresh(message) {
    const hint = sync.tokenHint();
    tokenInput.placeholder = hint || "github_pat_…";
    nameInput.disabled = Boolean(sync.getContextId());
    nameInput.value = sync.getContextLabel() || nameInput.value;
    enableSwitch.setAttribute("aria-checked", String(sync.isEnabled()));
    syncNowBtn.disabled = !sync.isReady();
    if (message) { status.textContent = message; return; }
    status.textContent = sync.isEnabled()
      ? `On · device ${sync.getContextId() || "—"} · last synced ${fmtWhen(sync.getLastSyncAt())}`
      : "Off — Today stays on this device.";
  }

  saveTokenBtn.addEventListener("click", () => {
    if (!sync.saveToken(tokenInput.value)) { toast("Enter a token first"); return; }
    tokenInput.value = "";
    refresh("Token saved.");
  });

  clearTokenBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear the token?",
      message: "Sync and Journal reporting stop until a token is entered again.",
      confirmLabel: "Clear token",
      danger: true,
    });
    if (!ok) return;
    sync.clearToken();
    sync.setEnabled(false);
    refresh("Token cleared.");
  });

  enableSwitch.addEventListener("click", async () => {
    if (sync.isEnabled()) {
      sync.setEnabled(false);
      refresh();
      return;
    }
    if (!sync.getToken()) { toast("Save an access token first"); return; }
    if (!sync.getContextId()) {
      const typed = nameInput.value.trim();
      if (!/[a-z0-9]/i.test(typed)) {
        toast("Enter a device name using English letters or numbers");
        nameInput.focus();
        return;
      }
      try {
        await sync.ensureContext(typed);
      } catch (error) {
        refresh(sync.describeError(error));
        return;
      }
      sync.setContextLabel(typed);
    }
    sync.setEnabled(true);
    refresh();
    const result = await syncRunner.runSync();
    refresh(result?.error ? sync.describeError(result.error) : undefined);
  });

  syncNowBtn.addEventListener("click", async () => {
    const result = await syncRunner.runSync();
    refresh(result?.error ? sync.describeError(result.error) : "Synced.");
  });

  syncRunner.onSyncState((state, detail) => {
    if (state === "syncing") { status.textContent = "Syncing…"; return; }
    if (state === "error") { refresh(sync.describeError(detail?.error)); return; }
    refresh();
  });

  refresh();
  return { refresh, nameInput };
}

function buildJournalSection(sec, syncSection) {
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Optionally send Today tasks to Daybook. Off by default, and independent from anything else.";
  sec.appendChild(intro);

  const enableRow = document.createElement("div");
  enableRow.className = "settings-row";
  const enableLabel = document.createElement("div");
  enableLabel.className = "lbl";
  enableLabel.textContent = "Include in journal";
  const enableSwitch = document.createElement("button");
  enableSwitch.type = "button";
  enableSwitch.className = "switch";
  enableSwitch.setAttribute("role", "switch");
  enableRow.append(enableLabel, enableSwitch);
  sec.appendChild(enableRow);

  const contentRow = document.createElement("div");
  contentRow.className = "settings-row";
  const contentLabel = document.createElement("div");
  contentLabel.className = "lbl";
  contentLabel.textContent = "Upload titles to private Journal";
  const contentSwitch = document.createElement("button");
  contentSwitch.type = "button";
  contentSwitch.className = "switch";
  contentSwitch.setAttribute("role", "switch");
  contentRow.append(contentLabel, contentSwitch);
  sec.appendChild(contentRow);

  const subtaskRow = document.createElement("div");
  subtaskRow.className = "settings-row";
  const subtaskLabel = document.createElement("div");
  subtaskLabel.className = "lbl";
  subtaskLabel.textContent = "Include subtask text";
  const subtaskSwitch = document.createElement("button");
  subtaskSwitch.type = "button";
  subtaskSwitch.className = "switch";
  subtaskSwitch.setAttribute("role", "switch");
  subtaskRow.append(subtaskLabel, subtaskSwitch);
  sec.appendChild(subtaskRow);
  const subtaskHint = document.createElement("p");
  subtaskHint.className = "hint";
  subtaskHint.textContent = "When off, only subtask counts (e.g. 1/2) are sent — never subtask titles.";
  sec.appendChild(subtaskHint);

  const status = document.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  sec.appendChild(status);

  const clearActivityRow = document.createElement("div");
  clearActivityRow.style.marginTop = "8px";
  const clearActivityBtn = document.createElement("button");
  clearActivityBtn.type = "button";
  clearActivityBtn.className = "btn";
  clearActivityBtn.textContent = "Clear captured activity";
  clearActivityRow.appendChild(clearActivityBtn);
  sec.appendChild(clearActivityRow);

  function refresh(state = journal.getJournalState()) {
    enableSwitch.setAttribute("aria-checked", String(state.enabled));
    contentSwitch.setAttribute("aria-checked", String(journal.isJournalContentEnabled()));
    subtaskSwitch.setAttribute("aria-checked", String(journal.isSubtaskTextEnabled()));
    status.textContent = state.enabled
      ? `${state.errorCode || state.status} · ${state.pendingCount || 0} pending`
      : "Off — no Today records are sent to Daybook.";
  }

  contentSwitch.addEventListener("click", async () => {
    await journal.setJournalContentEnabled(!journal.isJournalContentEnabled());
    refresh(await journal.refreshJournalState());
  });

  subtaskSwitch.addEventListener("click", () => {
    journal.setSubtaskTextEnabled(!journal.isSubtaskTextEnabled());
    refresh();
  });

  enableSwitch.addEventListener("click", async () => {
    const enabling = !journal.isJournalEnabled();
    let preferredName = sync.getContextLabel();
    if (enabling && !sync.getContextId()) {
      preferredName = syncSection.nameInput.value.trim();
      if (!/[a-z0-9]/i.test(preferredName)) {
        toast("Enter a device name in Sync using English letters or numbers");
        syncSection.nameInput.focus();
        return;
      }
    }
    const result = await journal.toggleJournal(enabling, preferredName);
    if (!result.ok) {
      toast(result.reason === "token" ? "Save an access token first" : "Set a device name first");
      refresh();
      return;
    }
    refresh(await journal.refreshJournalState());
    syncSection.refresh();
    toast(enabling ? "New Today tasks will be included in Daybook" : "Journal inclusion is off");
  });

  clearActivityBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear captured activity?",
      message: "This clears Today's 90-day local activity history on this device. Tasks and remote Journal records are unchanged.",
      confirmLabel: "Clear activity",
    });
    if (!ok) return;
    journal.clearActivityLedger();
    toast("Captured activity cleared on this device");
  });

  const detach = journal.onJournalState(refresh);
  journal.refreshJournalState().then(refresh);
  return detach;
}

export function openSettingsSheet({ onChanged }) {
  let settings = store.getSettings();

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Settings");

  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "ico"; closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  header.append(h2, closeBtn);

  const body = document.createElement("div");
  body.className = "sheet-body";

  function section(title) {
    const sec = document.createElement("div");
    sec.className = "settings-section";
    const h3 = document.createElement("h3");
    h3.textContent = title;
    sec.appendChild(h3);
    body.appendChild(sec);
    return sec;
  }

  function persist(partial) {
    settings = store.setSettings(partial);
    onChanged(settings);
  }

  const displaySec = section("Display");
  const fontRow = document.createElement("div");
  fontRow.className = "chiprow";
  const fontButtons = FONT_STEPS.map((v) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = `${v}px`;
    b.setAttribute("aria-pressed", String(v === settings.font));
    b.addEventListener("click", () => {
      fontButtons.forEach((btn) => btn.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      persist({ font: v });
    });
    fontRow.appendChild(b);
    return b;
  });
  displaySec.appendChild(fontRow);
  const resetFontRow = document.createElement("div");
  resetFontRow.className = "settings-row";
  resetFontRow.style.marginTop = "10px";
  const rfLbl = document.createElement("div"); rfLbl.className = "lbl"; rfLbl.textContent = "Restore default size";
  const rfBtn = document.createElement("button");
  rfBtn.type = "button"; rfBtn.className = "btn"; rfBtn.textContent = "Reset";
  rfBtn.addEventListener("click", () => { persist({ font: DEFAULT_SETTINGS.font }); closeSheet(); openSettingsSheet({ onChanged }); });
  resetFontRow.append(rfLbl, rfBtn);
  displaySec.appendChild(resetFontRow);

  const backupSec = section("Backup");
  const lastBackupP = document.createElement("p");
  lastBackupP.className = "hint";
  const days = daysSinceBackup(settings.lastBackupAt);
  lastBackupP.textContent = settings.lastBackupAt ? `Last backup: ${days} day${days === 1 ? "" : "s"} ago` : "No backup yet";
  backupSec.appendChild(lastBackupP);
  const backupRow = document.createElement("div");
  backupRow.style.display = "flex";
  backupRow.style.gap = "8px";
  backupRow.style.marginTop = "8px";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button"; exportBtn.className = "btn"; exportBtn.style.flex = "1"; exportBtn.textContent = "Export JSON";
  exportBtn.addEventListener("click", async () => { await exportBackup(); settings = store.getSettings(); lastBackupP.textContent = "Last backup: 0 days ago"; });
  const importBtn = document.createElement("button");
  importBtn.type = "button"; importBtn.className = "btn"; importBtn.style.flex = "1"; importBtn.textContent = "Import JSON";
  importBtn.addEventListener("click", async () => {
    const file = await pickImportFile();
    if (!file) return;
    await importBackup(file, { onDone: () => onChanged(store.getSettings()) });
  });
  backupRow.append(exportBtn, importBtn);
  backupSec.appendChild(backupRow);

  const syncSection = buildSyncSection(section("Sync"));
  const detachJournal = buildJournalSection(section("Journal"), syncSection);

  const dangerSec = section("Data");
  const resetRow = document.createElement("div");
  resetRow.className = "settings-row";
  const resetLbl = document.createElement("div"); resetLbl.className = "lbl"; resetLbl.textContent = "Reset everything";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button"; resetBtn.className = "btn danger"; resetBtn.textContent = "Reset";
  resetBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Reset everything?", message: "All tasks and settings on this device will be permanently removed.", confirmLabel: "Reset everything", danger: true });
    if (!ok) return;
    await store.clearAllTasks();
    settings = store.resetSettings();
    closeSheet();
    onChanged(settings);
  });
  resetRow.append(resetLbl, resetBtn);
  dangerSec.appendChild(resetRow);

  const aboutSec = section("About");
  const buildP = document.createElement("p");
  buildP.className = "hint";
  buildP.textContent = `App version ${APP_BUILD}`;
  aboutSec.appendChild(buildP);

  sheet.append(header, body);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  document.getElementById("sheet-host").appendChild(overlay);

  function closeSheet() {
    detachJournal();
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") closeSheet(); }
  closeBtn.addEventListener("click", closeSheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSheet(); });
  document.addEventListener("keydown", onKey);
}
