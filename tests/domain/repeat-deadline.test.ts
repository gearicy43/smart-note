import { describe, expect, it } from 'vitest';
import { nextRepeatDate } from '../../src/domain/repeat';
import { deadlineTone, defaultDeadlineSettings } from '../../src/domain/deadline';
import { createNode, createProject } from '../../src/domain/node';
import { Tree } from '../../src/domain/tree';
import { effectiveNodeTime } from '../../src/domain/aggregate';

it('project deadline is optional and independent of child deadlines', () => {
  const p = createProject({ id: 'p', title: 'P', now: '2026-09-01' });
  const task = createNode({ id: 't', projectId: 'p', parentId: 'p', title: 'T', now: '2026-09-01', nodeTime: '2026-09-30' });
  expect(effectiveNodeTime(p, new Tree([p, task]))).toBeNull();
  expect(effectiveNodeTime({ ...p, nodeTime: '2026-09-25' }, new Tree([p, task]))).toBe('2026-09-25');
});

describe('deadline colors', () => {
  const today = '2026-09-16';
  it('uses default boundaries, overdue and completed priority', () => {
    expect(deadlineTone('2026-09-18', false, today, defaultDeadlineSettings)).toBe('deep');
    expect(deadlineTone('2026-09-19', false, today, defaultDeadlineSettings)).toBe('light');
    expect(deadlineTone('2026-09-20', false, today, defaultDeadlineSettings)).toBe('normal');
    expect(deadlineTone('2026-09-10', false, today, defaultDeadlineSettings)).toBe('deep');
    expect(deadlineTone('2026-09-10', true, today, defaultDeadlineSettings)).toBe('done');
    expect(deadlineTone(null, false, today, defaultDeadlineSettings)).toBe('normal');
  });
  it('accepts configured thresholds', () => {
    expect(deadlineTone('2026-09-21', false, today, { ...defaultDeadlineSettings, deepDays: 5, lightDays: 7 })).toBe('deep');
  });
});

describe('repeating dates', () => {
  it('skips past weekly occurrences after an overdue completion', () => {
    expect(nextRepeatDate('2026-09-02', '2026-09-02', 'weekly', '2026-09-16')).toBe('2026-09-23');
  });
  it('keeps the original month-end day across short months', () => {
    expect(nextRepeatDate('2027-01-31', '2027-01-31', 'monthly', '2027-01-31')).toBe('2027-02-28');
    expect(nextRepeatDate('2027-02-28', '2027-01-31', 'monthly', '2027-02-28')).toBe('2027-03-31');
  });
});
