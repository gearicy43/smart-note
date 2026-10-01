import { effectiveCompletedAt, effectiveNodeTime } from './aggregate';
import type { Node } from './node';
import { Tree } from './tree';

export type CalendarEntry = { id: string; projectId: string; title: string; projectTitle: string; due: string; completed: boolean; kind: 'project' | 'single-project' | 'task' | 'recurring' };

export function projectCalendarEntries(project: Node, nodes: Node[]): CalendarEntry[] {
  const tree = new Tree(nodes);
  return nodes.flatMap(item => {
    const root = item.id === project.id;
    const leaf = tree.childrenOf(item.id).length === 0;
    // Auto dates on parent items repeat a child's date; show only explicit parent dates.
    if (!root && !leaf && item.nodeTimeMode !== 'manual') return [];
    const due = effectiveNodeTime(item, tree);
    const kind: CalendarEntry['kind'] = root ? (leaf ? 'single-project' : 'project') : 'task';
    return due ? [{ id: item.id, projectId: project.id, title: item.title, projectTitle: project.title, due: due.slice(0, 10), completed: !!effectiveCompletedAt(item, tree), kind }] : [];
  });
}

export function calendarDays(month: string): string[] {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(year, number - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = Math.ceil((offset + new Date(year, number, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(year, number - 1, index + 1 - offset);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
}

export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number);
  const next = new Date(year, number - 1 + offset, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}
