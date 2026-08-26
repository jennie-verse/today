/* ==========================================================================
   sync.js — device identity (name + GitHub token) that Journal uses to write
   to the private webapp-data repository.

   today has no cross-device data sync of its own — tasks stay local to each
   device (not in this release's scope). This file exists only so Journal has
   a token and a context id to write with, mirroring quill's minimal sync.js.

   The shared module is loaded with dynamic import() so a failure to fetch it
   never blocks the app's own local save/load.
   ========================================================================== */

let sharedPromise = null;

async function api() {
  if (!sharedPromise) {
    sharedPromise = import("../../shared/v1/sync.js").catch((cause) => {
      sharedPromise = null;
      const error = new Error("The shared sync module could not be loaded.");
      error.type = "network";
      error.cause = cause;
      throw error;
    });
  }
  return sharedPromise;
}

const NAMESPACE = "today";
const HOSTNAME = globalThis.location?.hostname || "";
const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io") ? HOSTNAME.slice(0, -".github.io".length) : "",
  repo: "webapp-data",
  branch: "main",
});

export const KEYS = Object.freeze({
  token: "sync.token.v1",
});

function readItem(key, fallback = "") {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
  catch { return fallback; }
}
function writeItem(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function removeItem(key) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

export function getToken() { return readItem(KEYS.token, ""); }
export function saveToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return false;
  return writeItem(KEYS.token, trimmed);
}
export function clearToken() { removeItem(KEYS.token); }
export function tokenHint() {
  const token = getToken();
  return token ? `••••${token.slice(-4)}` : "";
}

const CONTEXT_KEY = `${NAMESPACE}.syncContextId`;
const CONTEXT_LABEL_KEY = `${NAMESPACE}.syncContextLabel`;

export function getContextId() { return readItem(CONTEXT_KEY, ""); }
export function getContextLabel() { return readItem(CONTEXT_LABEL_KEY, ""); }
export function setContextLabel(label) { writeItem(CONTEXT_LABEL_KEY, String(label || "").trim()); }

// The id is created once and never changes — it goes into remote file names.
export async function ensureContext(preferredName) {
  const Shared = await api();
  return Shared.ensureContextId(NAMESPACE, () => String(preferredName || "").trim());
}

export function isReady() {
  return Boolean(getToken() && getContextId());
}

export function config() {
  return { ...REPO, token: getToken() };
}

export function describeError(error) {
  if (!error) return "Journal sync failed.";
  if (error.type === "auth") return "Token may be expired or lacks permission.";
  if (error.type === "network") return "Network unavailable. Try again later.";
  if (error.type === "notfound") return "The repository path was not found.";
  if (error.type === "conflict") return "Another device wrote first. Try again.";
  return "Journal sync failed. Check the token and repository access.";
}
