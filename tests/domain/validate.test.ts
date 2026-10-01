import { describe, it, expect } from 'vitest';
import { validateTree } from '../../src/domain/validate';
import { createProject, createNode, Node } from '../../src/domain/node';

const now = 'n';

describe('validateTree', () => {
  it('valid tree returns no errors', () => {
    const p = createProject({ id: 'p', title: 'P', now });
    const g = createNode({ id: 'g', projectId: 'p', parentId: 'p', title: 'g', now });
    const i = createNode({ id: 'i', projectId: 'p', parentId: 'g', title: 'i', now });
    expect(validateTree([p, g, i])).toEqual([]);
  });

  it('flags two roots', () => {
    const p1 = createProject({ id: 'p1', title: 'P', now });
    const p2 = createProject({ id: 'p2', title: 'P2', now });
    expect(validateTree([p1, p2])).toContain('must have exactly one root node (parentId === null)');
  });

  it('flags dangling parentId', () => {
    const i = createNode({ id: 'i', projectId: 'p', parentId: 'ghost', title: 'i', now });
    expect(validateTree([i])).toContain('node i references missing parent ghost');
  });

  it('no longer flags a node with children (type distinction removed)', () => {
    // Any node can have children — no "item must be leaf" rule anymore.
    const p = createProject({ id: 'p', title: 'P', now });
    const a = createNode({ id: 'a', projectId: 'p', parentId: 'p', title: 'a', now });
    const child = createNode({ id: 'c', projectId: 'p', parentId: 'a', title: 'c', now });
    expect(validateTree([p, a, child])).toEqual([]);
  });

  it('flags cycle', () => {
    const a: Node = { ...createNode({ id: 'a', projectId: 'p', parentId: 'b', title: 'a', now }) };
    const b: Node = { ...createNode({ id: 'b', projectId: 'p', parentId: 'a', title: 'b', now }) };
    const errs = validateTree([a, b]);
    expect(errs.some((e) => e.startsWith('cycle detected'))).toBe(true);
  });
});
