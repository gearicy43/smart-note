import { describe, it, expect } from 'vitest';
import { duplicateProjectTree, duplicateSubtree } from '../../src/domain/duplicate';
import { createProject, createNode, Node } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';

function sample(): Node[] {
  const p = createProject({ id: 'p1', title: 'Proj', now, progressNote: 'root note' });
  const g = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'G', now });
  const a = createNode({
    id: 'a', projectId: 'p1', parentId: 'g1', title: 'a', now,
    nodeTime: '2026-09-20', progressNote: 'in progress',
  });
  (a as Node).completedAt = '2026-09-18T10:00:00.000Z';
  return [p, g, a];
}

describe('duplicateProjectTree', () => {
  it('deep-copies with new ids, remaps parentId/projectId', () => {
    let n = 0;
    const idGen = () => `n${++n}`;
    const copy = duplicateProjectTree(sample(), 'Proj (副本)', '2026-09-15T00:00:00.000Z', idGen);
    expect(copy.map((x) => x.id)).not.toContain('p1');
    const root = copy.find((x) => x.parentId == null)!;
    expect(root.title).toBe('Proj (副本)');
    expect(copy.every((x) => x.projectId === root.id)).toBe(true);
    const g1c = copy.find((x) => x.parentId === root.id)!;
    expect(g1c.title).toBe('G');
    expect(copy.find((x) => x.parentId === g1c.id)).toBeTruthy();
  });

  it('keeps plan (nodeTime, progressNote) but resets completion', () => {
    let n = 0;
    const idGen = () => `n${++n}`;
    const copy = duplicateProjectTree(sample(), 'X', '2026-09-15T00:00:00.000Z', idGen);
    const item = copy.find((x) => x.id === 'n3')!;
    expect(item.nodeTime).toBe('2026-09-20'); // kept
    expect(item.progressNote).toBe('in progress'); // kept (default)
    expect(item.completedAt).toBeNull(); // reset
    expect(item.createdAt).toBe('2026-09-15T00:00:00.000Z');
  });

  it('preserves manual node-time override', () => {
    const nodes = sample();
    (nodes[1] as Node).nodeTimeMode = 'manual';
    (nodes[1] as Node).nodeTime = '2026-09-10';
    let n = 0;
    const idGen = () => `n${++n}`;
    const copy = duplicateProjectTree(nodes, 'X', '2026-09-15T00:00:00.000Z', idGen);
    const g = copy.find((x) => x.id === 'n2')!;
    expect(g.nodeTimeMode).toBe('manual');
    expect(g.nodeTime).toBe('2026-09-10');
  });
});

describe('duplicateSubtree', () => {
  it('copies a node with its whole subtree under the same parent', () => {
    let n = 0;
    const idGen = () => `c${++n}`;
    const { root, copies } = duplicateSubtree(sample(), 'g1', 'G（副本）', '2026-09-15T00:00:00.000Z', idGen);

    expect(root.id).toBe('c1');
    expect(root.title).toBe('G（副本）');
    expect(root.parentId).toBe('p1'); // same parent as the source
    expect(root.projectId).toBe('p1');
    expect(copies).toHaveLength(2); // g1 + a
    const child = copies.find((x) => x.id === 'c2')!;
    expect(child.parentId).toBe(root.id);
    expect(child.projectId).toBe('p1');
    expect(child.nodeTime).toBe('2026-09-20'); // plan kept
    expect(child.completedAt).toBeNull(); // execution state reset
  });

  it('ignores unrelated branches', () => {
    let n = 0;
    const nodes = [...sample(), createNode({ id: 'other', projectId: 'p1', parentId: 'p1', title: 'other', now })];
    const { copies } = duplicateSubtree(nodes, 'other', 'other（副本）', '2026-09-15T00:00:00.000Z', () => `c${++n}`);
    expect(copies).toHaveLength(1);
    expect(copies[0].parentId).toBe('p1');
  });
});
