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
