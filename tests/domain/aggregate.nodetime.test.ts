import { describe, it, expect } from 'vitest';
import { Tree } from '../../src/domain/tree';
import { effectiveNodeTime } from '../../src/domain/aggregate';
import { createProject, createNode, Node } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';
function tree(nodes: Node[]) {
  return new Tree(nodes);
}

describe('effectiveNodeTime', () => {
  it('leaf returns its nodeTime', () => {
    const i = createNode({ id: 'i', projectId: 'p', parentId: 'g', title: 'i', now, nodeTime: '2026-09-20' });
    expect(effectiveNodeTime(i, tree([i]))).toBe('2026-09-20');
  });

  it('leaf with no time returns null', () => {
    const i = createNode({ id: 'i', projectId: 'p', parentId: 'g', title: 'i', now });
    expect(effectiveNodeTime(i, tree([i]))).toBeNull();
  });

  it('non-leaf auto = max of children effective times', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now });
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now, nodeTime: '2026-09-20' });
    const b = createNode({ id: 'b', projectId: 'p', parentId: 'g', title: 'b', now, nodeTime: '2026-09-25' });
    expect(effectiveNodeTime(g, tree([p, g, a, b]))).toBe('2026-09-25');
  });

  it('non-leaf auto with no timed children returns null', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now });
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now });
    expect(effectiveNodeTime(g, tree([p, g, a]))).toBeNull();
  });

  it('auto recurses through nested non-leaf nodes', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g1 = createNode({ id: 'g1', projectId: 'p', parentId: 'p', title: 'G1', now });
    const g2 = createNode({ id: 'g2', projectId: 'p', parentId: 'g1', title: 'G2', now });
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'g2', title: 'a', now, nodeTime: '2026-09-30' });
    expect(effectiveNodeTime(g1, tree([p, g1, g2, a]))).toBe('2026-09-30');
  });

  it('manual group deadline overrides the latest child', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g: Node = { ...createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now }),
      nodeTimeMode: 'manual', nodeTime: '2026-09-10' };
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now, nodeTime: '2026-09-25' });
    expect(effectiveNodeTime(g, tree([p, g, a]))).toBe('2026-09-10');
    expect(effectiveNodeTime({ ...g, nodeTimeMode: 'auto', nodeTime: null }, tree([p, g, a]))).toBe('2026-09-25');
  });

  it('a node with children but auto mode and own nodeTime still aggregates (ignores own time)', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now, nodeTime: '2026-09-01' });
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now, nodeTime: '2026-09-25' });
    // auto mode: has children → aggregate, own nodeTime ignored
    expect(effectiveNodeTime(g, tree([p, g, a]))).toBe('2026-09-25');
  });
});
