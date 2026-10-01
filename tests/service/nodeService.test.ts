import { describe, it, expect } from 'vitest';
import { InMemoryRepository } from '../../src/repository/inMemory';
import { NodeService } from '../../src/service/nodeService';
import { createProject } from '../../src/domain/node';
import { Tree } from '../../src/domain/tree';
import { effectiveCompletedAt } from '../../src/domain/aggregate';

const now = '2026-09-14T00:00:00.000Z';

async function setup() {
  const repo = new InMemoryRepository();
  await repo.saveProjectTree([createProject({ id: 'p1', title: 'P', now })]);
  const svc = new NodeService(repo, () => 'fixed-id');
  return { repo, svc };
}

describe('NodeService', () => {
  it('creates a node under a parent', async () => {
    const { svc } = await setup();
    const n = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 'task', now });
    expect(n.parentId).toBe('p1');
    expect(n.nodeTimeMode).toBe('auto');
    expect(n.nodeTime).toBeNull();
  });

  it('resets a completed single item when it gains a child', async () => {
    const { repo, svc } = await setup();
    await svc.markComplete('p1', true, now);
    await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 'step', now });
    expect((await repo.loadProject('p1')).find(item => item.id === 'p1')?.completedAt).toBeNull();
  });

  it('markComplete sets/clears completedAt', async () => {
    const { svc } = await setup();
    const n = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 't', now });
    const done = await svc.markComplete(n.id, true, '2026-09-18T10:00:00.000Z');
    expect(done.completedAt).toBe('2026-09-18T10:00:00.000Z');
    const undone = await svc.markComplete(n.id, false, now);
    expect(undone.completedAt).toBeNull();
  });

  it('setNodeTimeMode switches between manual and auto', async () => {
    const { svc } = await setup();
    const n = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 'g', now });
    const manual = await svc.setNodeTimeMode(n.id, 'manual', now);
    expect(manual.nodeTimeMode).toBe('manual');
    const back = await svc.setNodeTimeMode(n.id, 'auto', now);
    expect(back.nodeTimeMode).toBe('auto');
  });

  it('updateNode can set nodeTime and title', async () => {
    const { svc } = await setup();
    const n = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 't', now });
    const updated = await svc.updateNode(n.id, { title: 'T2', nodeTime: '2026-09-25' }, now);
    expect(updated.title).toBe('T2');
    expect(updated.nodeTime).toBe('2026-09-25');
  });
});

describe('recurring completion', () => {
  it('keeps completed history and creates exactly one next weekly item', async () => {
    const repo = new InMemoryRepository();
    await repo.upsertNode(createProject({ id: 'p', title: 'P', now }));
    let seq = 0;
    const svc = new NodeService(repo, () => `item-${++seq}`);
    const first = await svc.createNode({ projectId: 'p', parentId: 'p', title: '周报', now, nodeTime: '2026-09-16' });
    await svc.updateNode(first.id, { repeatRule: 'weekly', repeatAnchor: '2026-09-16' }, now);
    await svc.markComplete(first.id, true, '2026-09-16T10:00:00.000Z');
    const items = (await repo.loadProject('p')).filter(n => n.parentId === 'p');
    expect(items).toHaveLength(2);
    expect(items.find(n => n.id === first.id)).toMatchObject({ completedAt: '2026-09-16T10:00:00.000Z', repeatRule: 'none' });
    expect(items.find(n => n.id !== first.id)).toMatchObject({ title: '周报', completedAt: null, nodeTime: '2026-09-23', repeatRule: 'weekly' });
    await svc.markComplete(first.id, true, '2026-09-16T11:00:00.000Z');
    expect((await repo.loadProject('p')).filter(n => n.parentId === 'p')).toHaveLength(2);
  });
});

describe('completion linkage', () => {
  // 完成状态只有一个来源：叶子节点自己存。父级一律算出来。
  async function setup() {
    const repo = new InMemoryRepository();
    await repo.saveProjectTree([createProject({ id: 'p1', title: 'P', now })]);
    let seq = 0;
    const svc = new NodeService(repo, () => `item-${++seq}`);
    const item = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 'item', now });
    const a = await svc.createNode({ projectId: 'p1', parentId: item.id, title: 'a', now });
    const b = await svc.createNode({ projectId: 'p1', parentId: item.id, title: 'b', now });
    const other = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 'other', now });
    return { repo, svc, item, a, b, other };
  }
  const load = async (repo: InMemoryRepository) => new Tree(await repo.loadProject('p1'));
  const doneAt = '2026-09-18T10:00:00.000Z';

  it('只给叶子写状态：完成一个叶子不会在父级留下完成标志', async () => {
    const { repo, svc, item, a } = await setup();
    await svc.setSubtreeCompletion(a.id, true, doneAt);
    const nodes = await repo.loadProject('p1');
    expect(nodes.find(n => n.id === a.id)?.completedAt).toBe(doneAt);
    expect(nodes.find(n => n.id === item.id)?.completedAt).toBeNull();
    // 但算出来的状态已经顺着父链上去了
    const t = new Tree(nodes);
    expect(effectiveCompletedAt(nodes.find(n => n.id === item.id)!, t)).toBeNull(); // b 还没完成
    expect(effectiveCompletedAt(nodes.find(n => n.id === 'p1')!, t)).toBeNull();
  });

  it('完成最后一片叶子后，事项和项目一起算成完成', async () => {
    const { repo, svc, a, b, other } = await setup();
    await svc.setSubtreeCompletion(a.id, true, doneAt);
    await svc.setSubtreeCompletion(b.id, true, doneAt);
    await svc.setSubtreeCompletion(other.id, true, doneAt);
    const t = await load(repo);
    expect(effectiveCompletedAt(t.get('p1')!, t)).not.toBeNull();
  });

  it('在已完成的父级下新增子项，父链立刻回到未完成', async () => {
    const { repo, svc, item, a, b, other } = await setup();
    for (const node of [a, b, other]) await svc.setSubtreeCompletion(node.id, true, doneAt);
    const before = await load(repo);
    expect(effectiveCompletedAt(before.get('p1')!, before)).not.toBeNull();

    await svc.createNode({ projectId: 'p1', parentId: item.id, title: '新子项', now });
    const t = await load(repo);
    expect(effectiveCompletedAt(t.get('p1')!, t)).toBeNull();
    expect(effectiveCompletedAt(t.get(item.id)!, t)).toBeNull();
  });

  it('完成一个父级会连它的叶子一起写，父级自己不存状态', async () => {
    const { repo, svc, item, a, b, other } = await setup();
    await svc.setSubtreeCompletion(item.id, true, doneAt);
    const nodes = await repo.loadProject('p1');
    expect(nodes.find(n => n.id === a.id)?.completedAt).toBe(doneAt);
    expect(nodes.find(n => n.id === b.id)?.completedAt).toBe(doneAt);
    expect(nodes.find(n => n.id === item.id)?.completedAt).toBeNull();
    expect(nodes.find(n => n.id === other.id)?.completedAt).toBeNull();
  });

  it('取消一片叶子会让整条父链回到未完成，兄弟叶子保持完成', async () => {
    const { repo, svc, a, b, other } = await setup();
    for (const node of [a, b, other]) await svc.setSubtreeCompletion(node.id, true, doneAt);
    await svc.setSubtreeCompletion(a.id, false, now);
    const t = await load(repo);
    expect(t.get(a.id)?.completedAt).toBeNull();
    expect(t.get(b.id)?.completedAt).toBe(doneAt);
    expect(effectiveCompletedAt(t.get('p1')!, t)).toBeNull();
  });

  it('取消一个父级会连它的叶子一起恢复', async () => {
    const { repo, svc, item, a, b } = await setup();
    await svc.setSubtreeCompletion(item.id, true, doneAt);
    await svc.setSubtreeCompletion(item.id, false, now);
    const t = await load(repo);
    expect(t.get(a.id)?.completedAt).toBeNull();
    expect(t.get(b.id)?.completedAt).toBeNull();
    expect(effectiveCompletedAt(t.get(item.id)!, t)).toBeNull();
  });

  it('重复事项走 setSubtreeCompletion 也会生成下一次', async () => {
    const repo = new InMemoryRepository();
    await repo.saveProjectTree([createProject({ id: 'p1', title: 'P', now })]);
    let seq = 0;
    const svc = new NodeService(repo, () => `item-${++seq}`);
    const task = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: '周报', now, nodeTime: '2026-09-16' });
    await svc.updateNode(task.id, { repeatRule: 'weekly', repeatAnchor: '2026-09-16' }, now);
    await svc.setSubtreeCompletion(task.id, true, '2026-09-16T10:00:00.000Z');
    const items = (await repo.loadProject('p1')).filter(n => n.parentId === 'p1');
    expect(items).toHaveLength(2);
    expect(items.find(n => n.id === task.id)).toMatchObject({ completedAt: '2026-09-16T10:00:00.000Z', repeatRule: 'none' });
    expect(items.find(n => n.id !== task.id)).toMatchObject({ nodeTime: '2026-09-23', completedAt: null });
  });

  it('没有子节点的项目就是叶子，可以手动完成', async () => {
    const repo = new InMemoryRepository();
    const svc = new NodeService(repo, () => 'unused');
    await repo.saveProjectTree([createProject({ id: 'solo', title: '空项目', now })]);
    await svc.setSubtreeCompletion('solo', true, doneAt);
    const t = new Tree(await repo.loadProject('solo'));
    expect(effectiveCompletedAt(t.get('solo')!, t)).toBe(doneAt);
  });
});

describe('duplicateNode', () => {
  it('copies the node and its subtree next to the original', async () => {
    const repo = new InMemoryRepository();
    await repo.saveProjectTree([createProject({ id: 'p1', title: 'P', now })]);
    let seq = 0;
    const svc = new NodeService(repo, () => `item-${++seq}`);
    const parent = await svc.createNode({ projectId: 'p1', parentId: 'p1', title: 'parent', now });
    const child = await svc.createNode({ projectId: 'p1', parentId: parent.id, title: 'child', now });
    await svc.setSubtreeCompletion(child.id, true, '2026-09-18T10:00:00.000Z');

    const copy = await svc.duplicateNode(parent.id, now);
    const nodes = await repo.loadProject('p1');
    expect(copy.title).toBe('parent（副本）');
    expect(copy.parentId).toBe('p1');
    expect(nodes.filter(n => n.parentId === 'p1').map(n => n.title).sort()).toEqual(['parent', 'parent（副本）']);
    const copiedChild = nodes.find(n => n.parentId === copy.id)!;
    expect(copiedChild.title).toBe('child');
    expect(copiedChild.completedAt).toBeNull(); // fresh copy is unfinished
    expect(nodes.find(n => n.id === child.id)?.completedAt).toBe('2026-09-18T10:00:00.000Z'); // original untouched
  });
});
