import { describe, it, expect } from 'vitest';
import { Tree } from '../../src/domain/tree';
import { effectiveCompletedAt, leafIds } from '../../src/domain/aggregate';
import { createProject, createNode, Node } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';
const done = '2026-09-14T08:00:00.000Z';
function tree(nodes: Node[]) {
  return new Tree(nodes);
}

// 项目 → 事项(item) → a / b，另外还有一条 other
function build() {
  const p = createProject({ id: 'p', title: '项目', now });
  const item = createNode({ id: 'item', projectId: 'p', parentId: 'p', title: '事项', now });
  const a = createNode({ id: 'a', projectId: 'p', parentId: 'item', title: 'a', now });
  const b = createNode({ id: 'b', projectId: 'p', parentId: 'item', title: 'b', now });
  const other = createNode({ id: 'other', projectId: 'p', parentId: 'p', title: '其他事项', now });
  return { p, item, a, b, other, nodes: [p, item, a, b, other] };
}

describe('叶子节点自己保存完成状态', () => {
  it('用户没点过就是未完成', () => {
    const { a, nodes } = build();
    expect(effectiveCompletedAt(a, tree(nodes))).toBeNull();
  });

  it('用户点了就是完成，点回去又变未完成', () => {
    const { a, nodes } = build();
    a.completedAt = done;
    expect(effectiveCompletedAt(a, tree(nodes))).toBe(done);
    a.completedAt = null;
    expect(effectiveCompletedAt(a, tree(nodes))).toBeNull();
  });

  it('没有子节点的项目就是叶子，可以手动完成', () => {
    const p = createProject({ id: 'solo', title: '空项目', now });
    p.completedAt = done;
    expect(effectiveCompletedAt(p, tree([p]))).toBe(done);
  });
});

describe('非叶子节点的完成状态由后代叶子算出来', () => {
  it('只完成一部分时，自己和所有祖先都还是未完成', () => {
    const { a, item, p, nodes } = build();
    a.completedAt = done;
    const t = tree(nodes);
    expect(effectiveCompletedAt(a, t)).toBe(done);
    expect(effectiveCompletedAt(item, t)).toBeNull();
    expect(effectiveCompletedAt(p, t)).toBeNull();
  });

  it('后代叶子全部完成时，沿父链向上自动完成', () => {
    const { a, b, other, item, p, nodes } = build();
    a.completedAt = done; b.completedAt = done; other.completedAt = done;
    const t = tree(nodes);
    expect(effectiveCompletedAt(item, t)).not.toBeNull();
    expect(effectiveCompletedAt(p, t)).not.toBeNull();
  });

  it('完成时间取最后一个完成的叶子', () => {
    const { a, b, item, nodes } = build();
    a.completedAt = '2026-09-14T08:00:00.000Z';
    b.completedAt = '2026-09-15T09:00:00.000Z';
    expect(effectiveCompletedAt(item, tree(nodes))).toBe('2026-09-15T09:00:00.000Z');
  });

  it('任意一个叶子恢复未完成，整条父链立刻回到未完成', () => {
    const { a, b, other, item, p, nodes } = build();
    a.completedAt = done; b.completedAt = done; other.completedAt = done;
    a.completedAt = null;
    const t = tree(nodes);
    expect(effectiveCompletedAt(item, t)).toBeNull();
    expect(effectiveCompletedAt(p, t)).toBeNull();
  });

  it('父级自己存着的旧 completedAt 不参与计算', () => {
    const { a, b, other, item, p, nodes } = build();
    b.completedAt = done; other.completedAt = done;
    item.completedAt = done; p.completedAt = done; // 旧数据留下的脏标志
    const t = tree(nodes);
    expect(effectiveCompletedAt(item, t)).toBeNull();
    expect(effectiveCompletedAt(p, t)).toBeNull();
    a.completedAt = done;
    expect(effectiveCompletedAt(p, t)).not.toBeNull();
  });

  it('新增一个未完成的子节点后，父链立刻变回未完成', () => {
    const { a, b, other, item, p, nodes } = build();
    a.completedAt = done; b.completedAt = done; other.completedAt = done;
    const fresh = createNode({ id: 'c', projectId: 'p', parentId: item.id, title: '新子项', now });
    const t = tree([...nodes, fresh]);
    expect(effectiveCompletedAt(item, t)).toBeNull();
    expect(effectiveCompletedAt(p, t)).toBeNull();
  });
});

describe('leafIds', () => {
  it('列出子树里真正保存完成状态的叶子', () => {
    const { a, b, other, item, p, nodes } = build();
    const t = tree(nodes);
    expect(leafIds(t, p.id).sort()).toEqual(['a', 'b', 'other']);
    expect(leafIds(t, item.id).sort()).toEqual(['a', 'b']);
    expect(leafIds(t, a.id)).toEqual(['a']);
  });
});
