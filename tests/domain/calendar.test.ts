import { describe, expect, it } from 'vitest';
import { calendarDays, projectCalendarEntries, shiftMonth } from '../../src/domain/calendar';
import { createNode, createProject } from '../../src/domain/node';

describe('calendar month', () => {
  it('keeps Monday columns and crosses year boundaries', () => {
    const days = calendarDays('2026-09');
    expect(days).toHaveLength(35);
    expect(days[0]).toBe('2026-08-31');
    expect(days.at(-1)).toBe('2026-10-04');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('shows concrete tasks and explicit deadlines without repeating automatic parent dates', () => {
    const now = '2026-09-17T00:00:00.000Z';
    const project = { ...createProject({ id: 'p', title: '项目', now }), nodeTime: '2026-09-17' };
    const group = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: '大项', now });
    const task = createNode({ id: 't', projectId: 'p', parentId: 'g', title: '子项', nodeTime: '2026-09-17', now });
    expect(projectCalendarEntries(project, [project, group, task]).map(item => item.id)).toEqual(['p', 't']);
    expect(projectCalendarEntries(project, [project, group, task])[0].kind).toBe('project');
    expect(projectCalendarEntries(project, [project])[0].kind).toBe('single-project');
    expect(projectCalendarEntries(project, [project, { ...group, nodeTimeMode: 'manual', nodeTime: '2026-09-18' }, task]).map(item => item.due)).toEqual(['2026-09-17', '2026-09-18', '2026-09-17']);
  });
});
