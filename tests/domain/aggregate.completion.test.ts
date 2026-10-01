import { describe, it, expect } from 'vitest';
import { Tree } from '../../src/domain/tree';
import { effectiveCompletedAt, progress } from '../../src/domain/aggregate';
import { createProject, createNode, Node } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';
function withDone(n: Node, at: string): Node {
  return { ...n, completedAt: at };
}

describe('effectiveCompletedAt', () => {
  it('leaf returns its completedAt', () => {
    const i = withDone(
      createNode({ id: 'i', projectId: 'p', parentId: 'g', title: 'i', now }),
      '2026-09-18T10:00:00.000Z',
    );
    expect(effectiveCompletedAt(i, new Tree([i]))).toBe('2026-09-18T10:00:00.000Z');
  });

  it('non-leaf returns null when NOT all children are complete', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now });
    const a = withDone(createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now }), '2026-09-18T10:00:00.000Z');
    const b = withDone(createNode({ id: 'b', projectId: 'p', parentId: 'g', title: 'b', now }), '2026-09-25T10:00:00.000Z');
    const c = createNode({ id: 'c', projectId: 'p', parentId: 'g', title: 'c', now }); // NOT done
    // only 2/3 done → not complete
    expect(effectiveCompletedAt(g, new Tree([p, g, a, b, c]))).toBeNull();
  });

  it('non-leaf returns max completion time when ALL children are complete', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now });
    const a = withDone(createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now }), '2026-09-18T10:00:00.000Z');
    const b = withDone(createNode({ id: 'b', projectId: 'p', parentId: 'g', title: 'b', now }), '2026-09-25T10:00:00.000Z');
    const c = withDone(createNode({ id: 'c', projectId: 'p', parentId: 'g', title: 'c', now }), '2026-09-20T10:00:00.000Z');
    // all 3 done → complete, time = latest = 9/25
    expect(effectiveCompletedAt(g, new Tree([p, g, a, b, c]))).toBe('2026-09-25T10:00:00.000Z');
  });

  it('non-leaf with no completed children returns null', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now });
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now });
    expect(effectiveCompletedAt(g, new Tree([p, g, a]))).toBeNull();
  });

  it('recursively: parent complete only when ALL descendants complete', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g1 = createNode({ id: 'g1', projectId: 'p', parentId: 'p', title: 'G1', now });
    const g2 = createNode({ id: 'g2', projectId: 'p', parentId: 'p', title: 'G2', now });
    // g1: all done
    const a = withDone(createNode({ id: 'a', projectId: 'p', parentId: 'g1', title: 'a', now }), '2026-09-18T10:00:00.000Z');
    // g2: not all done
    const b = withDone(createNode({ id: 'b', projectId: 'p', parentId: 'g2', title: 'b', now }), '2026-09-25T10:00:00.000Z');
    const c = createNode({ id: 'c', projectId: 'p', parentId: 'g2', title: 'c', now });
    // g2 not fully done → p not complete
    expect(effectiveCompletedAt(p, new Tree([p, g1, g2, a, b, c]))).toBeNull();

    // now complete c
    const cDone = withDone(c, '2026-09-30T10:00:00.000Z');
    // all done → p complete, time = latest = 9/30
    expect(effectiveCompletedAt(p, new Tree([p, g1, g2, a, b, cDone]))).toBe('2026-09-30T10:00:00.000Z');
  });
});

describe('progress', () => {
  it('counts completed/total leaves under a node', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'G', now });
    const a = withDone(createNode({ id: 'a', projectId: 'p', parentId: 'g', title: 'a', now }), 'x');
    const b = createNode({ id: 'b', projectId: 'p', parentId: 'g', title: 'b', now });
    const c = createNode({ id: 'c', projectId: 'p', parentId: 'g', title: 'c', now });
    expect(progress(g, new Tree([p, g, a, b, c]))).toEqual({ done: 1, total: 3 });
  });
});
