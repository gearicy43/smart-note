import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup } from '../../src/domain/backup';
import { defaultDeadlineSettings } from '../../src/domain/deadline';
import { createProject } from '../../src/domain/node';

describe('backup', () => {
  it('still accepts backups written before the trash field existed', () => {
    const project = createProject({ id: 'p', title: '项目', now: '2026-09-28' });
    const legacy: Record<string, unknown> = { ...project };
    delete legacy.deletedAt;
    const backup = createBackup([project], defaultDeadlineSettings, 'items');
    expect(parseBackup(JSON.stringify({ ...backup, nodes: [legacy] })).nodes[0].id).toBe('p');
  });

  it('round trips valid data and rejects a broken tree', () => {
    const project = createProject({ id: 'p', title: '项目', now: '2026-09-28' });
    expect(parseBackup(JSON.stringify(createBackup([project], defaultDeadlineSettings, 'items'))).nodes).toEqual([project]);
    const broken = createBackup([{ ...project, parentId: 'missing' }], defaultDeadlineSettings, 'items');
    expect(() => parseBackup(JSON.stringify(broken))).toThrow('项目结构不完整');
  });
});
