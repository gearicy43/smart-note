import { RepeatRule } from './node';

/** Next scheduled day after today, preserving the original day for monthly repeats. */
export function nextRepeatDate(due: string, anchor: string, rule: RepeatRule, today: string): string {
  if (rule === 'none') throw new Error('repeat rule is required');
  const day = Number(anchor.slice(8, 10));
  const [year, month, date] = due.slice(0, 10).split('-').map(Number);
  const format = (d: Date) => d.toISOString().slice(0, 10);
  if (rule === 'weekly') {
    const next = new Date(Date.UTC(year, month - 1, date));
    do { next.setUTCDate(next.getUTCDate() + 7); } while (format(next) <= today);
    return format(next);
  }
  let offset = 1;
  while (true) {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const next = format(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))));
    if (next > today) return next;
    offset++;
  }
}
