// @vitest-environment node
import { expect, test } from 'vitest';
import { runRepositoryContract } from './contract';
import { SqliteRepository, Persistence } from '../../src/repository/sqlite';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import path from 'node:path';

class MemPersistence implements Persistence {
  constructor(private buf?: Uint8Array) {}
  load(): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.buf);
  }
  save(data: Uint8Array): Promise<void> {
    this.buf = data;
    return Promise.resolve();
  }
}

// Verify SqliteRepository satisfies the same contract as InMemory.
// Requires network access to fetch the sql.js WASM from https://sql.js.org.
runRepositoryContract('Sqlite', async () => new SqliteRepository(new MemPersistence()));

test('migrates the legacy database without deleting notes', async () => {
  const require = createRequire(import.meta.url);
  const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js')), file) });
  const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE nodes (
    id TEXT PRIMARY KEY, projectId TEXT, parentId TEXT, type TEXT, title TEXT, sortOrder INTEGER,
    nodeTimeMode TEXT, manualNodeTime TEXT, itemNodeTime TEXT, completedAt TEXT, progressNote TEXT,
    createdAt TEXT, updatedAt TEXT
  )`);
  legacy.run(`INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, ['p', 'p', null, 'project', '保留下来', 0, 'manual', '2026-10-01', null, null, null, '2026-09-01', '2026-09-01']);
  const repo = new SqliteRepository(new MemPersistence(legacy.export()));
  expect(await repo.loadProject('p')).toMatchObject([{ id: 'p', title: '保留下来', nodeTime: '2026-10-01' }]);
});

test('adds the trash column to a database created before soft delete', async () => {
  const require = createRequire(import.meta.url);
  const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js')), file) });
  const existing = new SQL.Database();
  existing.run(`CREATE TABLE nodes (
    id TEXT PRIMARY KEY, projectId TEXT, parentId TEXT, title TEXT, sortOrder INTEGER,
    nodeTimeMode TEXT, nodeTime TEXT, completedAt TEXT, progressNote TEXT,
    repeatRule TEXT DEFAULT 'none', repeatAnchor TEXT, description TEXT, tags TEXT, createdAt TEXT, updatedAt TEXT
  )`);
  existing.run(
    `INSERT INTO nodes (id, projectId, parentId, title, sortOrder, nodeTimeMode, nodeTime, completedAt, progressNote, repeatRule, repeatAnchor, description, tags, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['p', 'p', null, '旧项目', 0, 'auto', null, null, null, 'none', null, null, '[]', '2026-09-01', '2026-09-01'],
  );
  const repo = new SqliteRepository(new MemPersistence(existing.export()));
  expect(await repo.loadProject('p')).toMatchObject([{ id: 'p', title: '旧项目', deletedAt: null }]);
  await repo.upsertNode({ ...(await repo.loadProject('p'))[0], deletedAt: '2026-09-30T00:00:00.000Z' });
  expect((await repo.loadProject('p'))[0].deletedAt).toBe('2026-09-30T00:00:00.000Z');
});

test('failed persistence rejects and restores the previous in-memory and saved data', async () => {
  let saved: Uint8Array | undefined;
  let fail = false;
  const persistence: Persistence = {
    load: async () => saved,
    save: async data => {
      if (fail) throw new Error('storage full');
      saved = data;
    },
  };
  const repo = new SqliteRepository(persistence);
  const project = { id: 'p', projectId: 'p', parentId: null, title: 'before', sortOrder: 0, nodeTimeMode: 'auto', nodeTime: null, completedAt: null, progressNote: null, repeatRule: 'none', repeatAnchor: null, deletedAt: null, createdAt: '2026-10-06', updatedAt: '2026-10-06' } as const;
  await repo.upsertNode(project);
  fail = true;
  await expect(repo.upsertNode({ ...project, title: 'unsaved' })).rejects.toMatchObject({ name: 'NoteStorageError' });
  expect((await repo.loadProject('p'))[0].title).toBe('before');
  expect((await new SqliteRepository(persistence).loadProject('p'))[0].title).toBe('before');
  fail = false;
  await repo.upsertNode({ ...project, title: 'retry saved' });
  expect((await new SqliteRepository(persistence).loadProject('p'))[0].title).toBe('retry saved');
});

test('a failed tree replacement restores the entire previous tree', async () => {
  const repo = new SqliteRepository(new MemPersistence());
  const project = { id: 'p', projectId: 'p', parentId: null, title: 'before', sortOrder: 0, nodeTimeMode: 'auto', nodeTime: null, completedAt: null, progressNote: null, repeatRule: 'none', repeatAnchor: null, deletedAt: null, createdAt: '2026-10-06', updatedAt: '2026-10-06' } as const;
  await repo.upsertNode(project);
  await expect(repo.saveProjectTree([{ ...project, title: {} as unknown as string }])).rejects.toMatchObject({ name: 'NoteStorageError' });
  expect(await repo.loadProject('p')).toMatchObject([{ id: 'p', title: 'before' }]);
});

test('writes are serialized even when the first persistence operation is delayed', async () => {
  let saved: Uint8Array | undefined;
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  const persistence: Persistence = {
    load: async () => saved,
    save: async data => { if (++count === 1) { started(); await gate; } saved = data; },
  };
  const repo = new SqliteRepository(persistence);
  const project = { id: 'p', projectId: 'p', parentId: null, title: 'first', sortOrder: 0, nodeTimeMode: 'auto', nodeTime: null, completedAt: null, progressNote: null, repeatRule: 'none', repeatAnchor: null, deletedAt: null, createdAt: '2026-10-06', updatedAt: '2026-10-06' } as const;
  const first = repo.upsertNode(project);
  await start;
  const second = repo.upsertNode({ ...project, title: 'second' });
  expect(count).toBe(1);
  release();
  await Promise.all([first, second]);
  expect(count).toBe(2);
  expect((await new SqliteRepository(persistence).loadProject('p'))[0].title).toBe('second');
});

test('read failure is not treated as an empty database', async () => {
  let writes = 0;
  const repo = new SqliteRepository({ load: async () => { throw new Error('cannot read'); }, save: async () => { writes++; } });
  await expect(repo.listProjects()).rejects.toThrow('cannot read');
  expect(writes).toBe(0);
});
