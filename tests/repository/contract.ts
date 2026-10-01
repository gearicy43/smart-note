import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/repository/types';
import { createProject, createNode, Node } from '../../src/domain/node';

const now = '2026-09-14T00:00:00.000Z';

export function runRepositoryContract(name: string, make: () => Promise<NodeRepository>) {
  describe(`repository contract: ${name}`, () => {
    it('lists projects after saving a tree', async () => {
      const r = await make();
      const p = createProject({ id: 'p1', title: 'P', now });
      const g = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'g', now });
      await r.saveProjectTree([p, g]);
      const list = await r.listProjects();
      expect(list.map((x) => x.id)).toEqual(['p1']);
    });

    it('loadProject returns the full tree', async () => {
      const r = await make();
      const p = createProject({ id: 'p1', title: 'P', now });
      const g = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'g', now });
      const i = createNode({ id: 'i1', projectId: 'p1', parentId: 'g1', title: 'i', now });
      await r.saveProjectTree([p, g, i]);
      const tree = await r.loadProject('p1');
      expect(tree.map((x) => x.id).sort()).toEqual(['g1', 'i1', 'p1']);
    });

    it('persists a recurring rule and its anchor', async () => {
      const r = await make();
      const p = createProject({ id: 'p-repeat', title: 'P', now });
      const task: Node = { ...createNode({ id: 'task-repeat', projectId: p.id, parentId: p.id, title: 'monthly', now, nodeTime: '2026-09-30' }), repeatRule: 'monthly', repeatAnchor: '2026-09-30' };
      await r.saveProjectTree([p, task]);
      expect((await r.loadProject(p.id)).find(n => n.id === task.id)).toMatchObject({ repeatRule: 'monthly', repeatAnchor: '2026-09-30' });
    });

    it('keeps the item order when a row is updated', async () => {
      const r = await make();
      const p = createProject({ id: 'p-order', title: 'P', now });
      const a = createNode({ id: 'a', projectId: 'p-order', parentId: 'p-order', title: 'a', now });
      const b = createNode({ id: 'b', projectId: 'p-order', parentId: 'p-order', title: 'b', now });
      await r.saveProjectTree([p, a, b]);
      await r.upsertNode({ ...a, completedAt: '2026-09-20T00:00:00.000Z' });
      expect((await r.loadProject('p-order')).map((node) => node.id)).toEqual(['p-order', 'a', 'b']);
    });

    it('persists the trash marker (soft delete)', async () => {
      const r = await make();
      const p = { ...createProject({ id: 'p-trash', title: 'P', now }), deletedAt: '2026-09-20T00:00:00.000Z' };
      await r.saveProjectTree([p]);
      expect((await r.loadProject(p.id))[0].deletedAt).toBe('2026-09-20T00:00:00.000Z');
      const restored = { ...p, deletedAt: null };
      await r.saveProjectTree([restored]);
      expect((await r.loadProject(p.id))[0].deletedAt).toBeNull();
    });

    it('persists optional description and tags', async () => {
      const r = await make();
      const p = { ...createProject({ id: 'p-meta', title: 'P', now }), description: '项目描述', tags: ['工作', '重点'] };
      await r.saveProjectTree([p]);
      expect((await r.loadProject(p.id))[0]).toMatchObject({ description: '项目描述', tags: ['工作', '重点'] });
    });

    it('upsertNode updates an existing node', async () => {
      const r = await make();
      const p = createProject({ id: 'p1', title: 'P', now });
      await r.saveProjectTree([p]);
      const updated: Node = { ...p, title: 'P2', updatedAt: now };
      await r.upsertNode(updated);
      const [got] = await r.loadProject('p1');
      expect(got.title).toBe('P2');
    });

    it('deleteNode cascades the subtree', async () => {
      const r = await make();
      const p = createProject({ id: 'p1', title: 'P', now });
      const g = createNode({ id: 'g1', projectId: 'p1', parentId: 'p1', title: 'g', now });
      const i = createNode({ id: 'i1', projectId: 'p1', parentId: 'g1', title: 'i', now });
      await r.saveProjectTree([p, g, i]);
      await r.deleteNode('g1');
      const tree = await r.loadProject('p1');
      expect(tree.map((x) => x.id)).toEqual(['p1']);
    });

    it('replaces all data for backup restore', async () => {
      const r = await make();
      await r.saveProjectTree([createProject({ id: 'old', title: 'Old', now })]);
      const replacement = createProject({ id: 'new', title: 'New', now });
      await r.replaceAll([replacement]);
      expect((await r.listProjects()).map(node => node.id)).toEqual(['new']);
    });
  });
}
