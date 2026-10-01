import { describe, it, expect } from 'vitest';
import { InMemoryRepository } from '../../src/repository/inMemory';
import { ProjectService, RECURRING_PROJECT_ID } from '../../src/service/projectService';
import { createProject, createNode, Node } from '../../src/domain/node';
import { Tree } from '../../src/domain/tree';
import { effectiveNodeTime } from '../../src/domain/aggregate';

const now = '2026-09-14T00:00:00.000Z';

describe('ProjectService', () => {
  it('duplicateProject copies tree, resets completion, keeps plan', async () => {
    const repo = new InMemoryRepository();
    let n = 0;
    const svc = new ProjectService(repo, () => `n${++n}`);
    const p = createProject({ id: 'p1', title: 'Proj', now });
    const g = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'g', now });
    const a = createNode({ id: 'a', projectId: 'p1', parentId: 'g1', title: 'a', now, nodeTime: '2026-09-20' });
    (a as Node).completedAt = '2026-09-18T10:00:00.000Z';
    await repo.saveProjectTree([p, g, a]);

    const newRoot = await svc.duplicateProject('p1', 'Proj (副本)', '2026-09-15T00:00:00.000Z');
    expect(newRoot.title).toBe('Proj (副本)');
    const copy = await repo.loadProject(newRoot.id);
    expect(copy.length).toBe(3);
    const copyLeaf = copy.find((x) => x.parentId !== null && !copy.some((y) => y.parentId === x.id))!;
    expect(copyLeaf.nodeTime).toBe('2026-09-20');
    expect(copyLeaf.completedAt).toBeNull();
    const copyGroup = copy.find((x) => x.parentId === newRoot.id)!;
    expect(effectiveNodeTime(copyGroup, new Tree(copy))).toBe('2026-09-20');
  });

  it('createProject + listProjects', async () => {
    const repo = new InMemoryRepository();
    let n = 0;
    const svc = new ProjectService(repo, () => `n${++n}`);
    await svc.createProject('New', now);
    expect((await svc.listProjects()).length).toBe(1);
  });

  it('moves existing active repeating leaves into the standalone list', async () => {
    const repo = new InMemoryRepository();
    const svc = new ProjectService(repo, () => 'unused');
    const p = createProject({ id: 'project', title: 'Project', now });
    const recurring: Node = { ...createNode({ id: 'repeat', projectId: p.id, parentId: p.id, title: '周报', now, nodeTime: '2026-09-18' }), repeatRule: 'weekly', repeatAnchor: '2026-09-18' };
    const history: Node = { ...createNode({ id: 'history', projectId: p.id, parentId: p.id, title: '上周周报', now, nodeTime: '2026-09-11' }), repeatAnchor: '2026-09-11', completedAt: now };
    const ordinary = createNode({ id: 'ordinary', projectId: p.id, parentId: p.id, title: '普通事项', now });
    await repo.saveProjectTree([p, recurring, history, ordinary]);
    expect((await svc.listProjects()).map(node => node.id)).toEqual(['project']);
    expect((await repo.loadProject('project')).map(node => node.id)).toEqual(['project', 'ordinary']);
    const standalone = await repo.loadProject(RECURRING_PROJECT_ID);
    expect(standalone.find(node => node.id === 'repeat')).toMatchObject({ parentId: RECURRING_PROJECT_ID, repeatRule: 'weekly' });
    expect(standalone.find(node => node.id === 'history')).toMatchObject({ parentId: RECURRING_PROJECT_ID, completedAt: now });
  });
  it('项目的分组和界面上算出来的完成状态完全一致', async () => {
    const repo = new InMemoryRepository();
    const svc = new ProjectService(repo, () => 'unused');
    // 没有事项的项目就是叶子：它自己的 completedAt 说了算
    const active = createProject({ id: 'active', title: 'Active', now });
    const solo = { ...createProject({ id: 'solo', title: '空项目', now }), completedAt: '2026-09-20T10:00:00.000Z' };
    // 有事项的项目：只看后代叶子，自己那个 completedAt 不算数
    const allDone = createProject({ id: 'children-done', title: 'Children done', now });
    const kid = { ...createNode({ id: 'kid', projectId: 'children-done', parentId: 'children-done', title: 'kid', now }), completedAt: '2026-09-21T10:00:00.000Z' };
    const half = createProject({ id: 'half', title: 'Half', now });
    const halfKid = createNode({ id: 'half-kid', projectId: 'half', parentId: 'half', title: 'kid', now });
    await repo.saveProjectTree([active]);
    await repo.saveProjectTree([solo]);
    await repo.saveProjectTree([allDone, kid]);
    await repo.saveProjectTree([half, halfKid]);

    expect((await svc.listProjects()).map(node => node.id).sort()).toEqual(['active', 'half']);
    expect((await svc.listArchivedProjects()).map(node => node.id).sort()).toEqual(['children-done', 'solo']);
  });

  it('项目自己存着旧的 completedAt、但还有没做完的叶子时，仍然算活动中', async () => {
    const repo = new InMemoryRepository();
    const svc = new ProjectService(repo, () => 'unused');
    const stale: Node = { ...createProject({ id: 'stale', title: 'Stale', now }), completedAt: '2026-09-20T10:00:00.000Z' };
    const kid = createNode({ id: 'kid', projectId: 'stale', parentId: 'stale', title: 'kid', now });
    await repo.saveProjectTree([stale, kid]);
    expect((await svc.listProjects()).map(node => node.id)).toEqual(['stale']);
    expect(await svc.listArchivedProjects()).toEqual([]);
  });
});

describe('垃圾桶（软删除）', () => {
  const deletedAt = '2026-09-20T00:00:00.000Z';

  async function withTree(completed = false) {
    const repo = new InMemoryRepository();
    let n = 0;
    const svc = new ProjectService(repo, () => `n${++n}`);
    const p = createProject({ id: 'p1', title: 'Proj', now });
    const item = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'g', now });
    // 完成状态只存在叶子上
    const child = { ...createNode({ id: 'c1', projectId: 'p1', parentId: 'g1', title: 'c', now }), completedAt: completed ? '2026-09-19T00:00:00.000Z' : null };
    await repo.saveProjectTree([p, item, child]);
    return { repo, svc, p };
  }

  it('删除只给项目根节点打标记，事项和子项原样保留', async () => {
    const { repo, svc } = await withTree();
    await svc.deleteProject('p1', deletedAt);

    expect(await svc.listProjects()).toEqual([]);
    expect(await svc.listArchivedProjects()).toEqual([]);
    expect((await svc.listTrashedProjects()).map(node => node.id)).toEqual(['p1']);

    const tree = await repo.loadProject('p1');
    expect(tree.map(node => node.id).sort()).toEqual(['c1', 'g1', 'p1']);
    expect(tree.find(node => node.id === 'p1')?.deletedAt).toBe(deletedAt);
    expect(tree.filter(node => node.parentId !== null).every(node => node.deletedAt === null)).toBe(true);
  });

  it('恢复到删除前的分组：活动中 / 已完成', async () => {
    const active = await withTree();
    await active.svc.deleteProject('p1', deletedAt);
    await active.svc.restoreProject('p1', '2026-09-21T00:00:00.000Z');
    expect((await active.svc.listProjects()).map(node => node.id)).toEqual(['p1']);
    expect(await active.svc.listTrashedProjects()).toEqual([]);

    const done = await withTree(true);
    await done.svc.deleteProject('p1', deletedAt);
    expect(await done.svc.listArchivedProjects()).toEqual([]);
    await done.svc.restoreProject('p1', '2026-09-21T00:00:00.000Z');
    expect((await done.svc.listArchivedProjects()).map(node => node.id)).toEqual(['p1']);
    expect(await done.svc.listProjects()).toEqual([]);
  });

  it('彻底删除会连同事项和子项一起移除', async () => {
    const { repo, svc } = await withTree();
    await svc.deleteProject('p1', deletedAt);
    await svc.purgeProject('p1');
    expect(await repo.loadProject('p1')).toEqual([]);
    expect(await svc.listTrashedProjects()).toEqual([]);
  });

  it('清空垃圾桶删掉全部项目及内容', async () => {
    const repo = new InMemoryRepository();
    let n = 0;
    const svc = new ProjectService(repo, () => `n${++n}`);
    const keep = createProject({ id: 'keep', title: 'keep', now });
    const a = createProject({ id: 'a', title: 'a', now });
    const b = createProject({ id: 'b', title: 'b', now });
    await repo.saveProjectTree([keep]);
    await repo.saveProjectTree([a, createNode({ id: 'a1', projectId: 'a', parentId: 'a', title: 'a1', now })]);
    await repo.saveProjectTree([b]);
    await svc.deleteProject('a', deletedAt);
    await svc.deleteProject('b', deletedAt);

    await svc.emptyTrash();
    expect(await svc.listTrashedProjects()).toEqual([]);
    expect(await repo.loadProject('a')).toEqual([]);
    expect((await svc.listProjects()).map(node => node.id)).toEqual(['keep']);
  });
});
