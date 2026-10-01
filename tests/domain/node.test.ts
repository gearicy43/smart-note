import { describe, it, expect } from 'vitest';
import { createNode, createProject } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';

describe('node constructors', () => {
  it('createProject makes a root (parentId null, projectId = own id)', () => {
    const p = createProject({ id: 'p1', title: 'Proj', now });
    expect(p.parentId).toBeNull();
    expect(p.projectId).toBe('p1');
    expect(p.nodeTimeMode).toBe('auto');
    expect(p.nodeTime).toBeNull();
    expect(p.completedAt).toBeNull();
  });

  it('createNode makes a child node with auto mode', () => {
    const n = createNode({ id: 'n1', projectId: 'p1', parentId: 'p1', title: 'task', now });
    expect(n.nodeTimeMode).toBe('auto');
    expect(n.nodeTime).toBeNull();
    expect(n.parentId).toBe('p1');
  });

  it('createNode accepts optional nodeTime and progressNote', () => {
    const n = createNode({
      id: 'n1', projectId: 'p1', parentId: 'p1', title: 't', now,
      nodeTime: '2026-09-20', progressNote: 'notes',
    });
    expect(n.nodeTime).toBe('2026-09-20');
    expect(n.progressNote).toBe('notes');
  });
});
