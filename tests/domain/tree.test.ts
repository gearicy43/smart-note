import { describe, it, expect } from 'vitest';
import { Tree } from '../../src/domain/tree';
import { createProject, createNode } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';

function sample() {
  const p = createProject({ id: 'p1', title: 'P', now });
  const g = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'G', now });
  const i1 = createNode({ id: 'i1', projectId: 'p1', parentId: 'g1', title: 'a', now });
  return [p, g, i1];
}

describe('Tree', () => {
  it('indexes children by parentId', () => {
    const t = new Tree(sample());
    expect(t.childrenOf('p1').map((n) => n.id)).toEqual(['g1']);
    expect(t.childrenOf('g1').map((n) => n.id)).toEqual(['i1']);
    expect(t.childrenOf('i1')).toEqual([]);
  });

  it('finds root (parentId === null)', () => {
    const t = new Tree(sample());
    expect(t.root().id).toBe('p1');
  });

  it('isLeaf is dynamic — true when no children, false otherwise', () => {
    const t = new Tree(sample());
    expect(t.isLeaf('i1')).toBe(true);
    expect(t.isLeaf('g1')).toBe(false);
  });
});
