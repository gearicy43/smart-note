import { vi, test, expect } from 'vitest';
import { createNode } from '../../src/domain/node';

const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@tarojs/taro', () => ({ default: {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
} }));

import { TaroRepository } from '../../src/platform/taro';

test('小程序本地存储可恢复项目树并级联删除', async () => {
  storage.clear();
  const repo = new TaroRepository();
  const root = createNode({ id: 'p', projectId: 'p', parentId: null, title: '项目', now: '2026-09-16' });
  const child = createNode({ id: 'c', projectId: 'p', parentId: 'p', title: '事项', now: '2026-09-16' });
  await repo.upsertNode(root);
  await repo.upsertNode(child);
  expect((await new TaroRepository().loadProject('p')).map(node => node.id)).toEqual(['p', 'c']);
  await repo.deleteNode('p');
  expect(await new TaroRepository().loadProject('p')).toEqual([]);
});
