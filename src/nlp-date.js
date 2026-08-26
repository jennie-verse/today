// nlp-date.js — regex-only natural-language date/time extraction. No AI, no
// network. On any non-match the caller keeps the raw text as the title and
// does nothing else (see parseNaturalLanguage's fallback branch).
//
// Recurring phrases ("매주 화요일", "every Monday") are intentionally left
// unparsed — repeating tasks are out of scope, so the parser must not
// quietly turn "매주 화요일 청소" into a one-off Tuesday task.
import { dateKey, pad2 } from "./model.js";

const KO_WEEKDAY = { "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6 };
const EN_WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function addDaysKey(now, days) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return dateKey(d);
}

// "next week" = the week that starts on the upcoming Sunday, strictly after
// the current week (so typing this on a Sunday means 7+ days out, not 0).
function nextWeekOffset(now, targetIdx) {
  const todayIdx = now.getDay();
  let toSunday = (7 - todayIdx) % 7;
  if (toSunday === 0) toSunday = 7;
  return toSunday + targetIdx;
}

function precededByRepeatMarker(str, index) {
  const before = str.slice(Math.max(0, index - 8), index);
  return /(매주|매일|every)\s*$/i.test(before);
}

function tryMatch(str, regex) {
  regex.lastIndex = 0;
  return regex.exec(str);
}

function extractDate(str, now) {
  let m;

  // 다음주 X요일 — next-week Korean weekday
  m = tryMatch(str, /다음\s*주\s*(일|월|화|수|목|금|토)요일/);
  if (m && !precededByRepeatMarker(str, m.index)) {
    return { match: m[0], index: m.index, key: addDaysKey(now, nextWeekOffset(now, KO_WEEKDAY[m[1]])) };
  }

  m = tryMatch(str, /모레/);
  if (m) return { match: m[0], index: m.index, key: addDaysKey(now, 2) };

  m = tryMatch(str, /내일/);
  if (m) return { match: m[0], index: m.index, key: addDaysKey(now, 1) };

  m = tryMatch(str, /오늘/);
  if (m) return { match: m[0], index: m.index, key: addDaysKey(now, 0) };

  // N월 N일
  m = tryMatch(str, /(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const candidate = new Date(now.getFullYear(), month - 1, day);
      if (candidate.getMonth() === month - 1 && candidate.getDate() === day) {
        return { match: m[0], index: m.index, key: dateKey(candidate) };
      }
    }
  }

  // bare Korean weekday — nearest occurrence, never today (오늘 already covers that)
  m = tryMatch(str, /(일|월|화|수|목|금|토)요일/);
  if (m && !precededByRepeatMarker(str, m.index)) {
    const targetIdx = KO_WEEKDAY[m[1]];
    let diff = (targetIdx - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return { match: m[0], index: m.index, key: addDaysKey(now, diff) };
  }

  // next Mon / next Tuesday (English)
  m = tryMatch(str, /\bnext\s+(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i);
  if (m && !precededByRepeatMarker(str, m.index)) {
    const targetIdx = EN_WEEKDAY[m[1].toLowerCase()];
    return { match: m[0], index: m.index, key: addDaysKey(now, nextWeekOffset(now, targetIdx)) };
  }

  m = tryMatch(str, /\btomorrow\b/i);
  if (m) return { match: m[0], index: m.index, key: addDaysKey(now, 1) };

  m = tryMatch(str, /\btoday\b/i);
  if (m) return { match: m[0], index: m.index, key: addDaysKey(now, 0) };

  return null;
}

function extractTime(str) {
  let m;

  m = tryMatch(str, /오전\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h >= 0 && h <= 11 && min >= 0 && min <= 59) return { match: m[0], index: m.index, minutes: h * 60 + min };
  }

  m = tryMatch(str, /오후\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (m) {
    let h = parseInt(m[1], 10) % 12 + 12;
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h >= 12 && h <= 23 && min >= 0 && min <= 59) return { match: m[0], index: m.index, minutes: h * 60 + min };
  }

  m = tryMatch(str, /\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { match: m[0], index: m.index, minutes: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) };

  m = tryMatch(str, /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return { match: m[0], index: m.index, minutes: h * 60 + min };
  }

  return null;
}

function removeMatches(str, matches) {
  let out = str;
  // Remove longest-first so overlapping indices from an earlier removal
  // don't shift a later one's position.
  const sorted = matches.filter(Boolean).sort((a, b) => b.index - a.index);
  for (const { match, index } of sorted) {
    out = out.slice(0, index) + out.slice(index + match.length);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

// Only call this once IME composition has ended (compositionend) — see the
// app's input wiring. Never on an in-progress composition string.
export function parseNaturalLanguage(rawText, { now = new Date() } = {}) {
  const raw = String(rawText || "");
  const date = extractDate(raw, now);
  const time = extractTime(raw);
  const title = removeMatches(raw, [date, time]) || raw.trim();

  if (!date && !time) return { title: raw.trim(), scheduledFor: null, scheduledAtMinutes: null };
  return {
    title,
    scheduledFor: date ? date.key : dateKey(now),
    scheduledAtMinutes: time ? time.minutes : null,
  };
}
