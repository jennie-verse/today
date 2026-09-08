import { dayEntries } from './timeline-model.js';
import { formatClock, dayDifference } from './timeline-time.js';
const mdText = text => text.replace(/([\\`*_[\]{}<>~])/g, '\\$1');
export function timeLabel(entry, { offsets = false } = {}) {
  const differing = entry.endedAt && entry.startedAt.slice(-6) !== entry.endedAt.slice(-6);
  const clock = iso => `${formatClock(iso)}${offsets || differing ? ` (UTC${iso.slice(-6)})` : ''}`;
  let label = clock(entry.startedAt);
  if (entry.endedAt) {
    label += ` - ${clock(entry.endedAt)}`;
    const days = dayDifference(entry.startDate, entry.endDate);
    if (days) label += ` (+${days}d)`;
  }
  return label;
}
export function timelineMarkdown(entries, date) {
  const rows = dayEntries(entries, date);
  const base = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]?.timeZone;
  return rows.map(r => `${timeLabel(r, { offsets: r.timeZone !== base })}${r.title ? ` ${mdText(r.title)}` : ''}`).join('  \n') + (rows.length ? '\n' : '');
}
