import initSqlJs from 'sql.js';
import { Node } from '../domain/node';
import { NodeRepository } from './types';

// sql.js ships types via `export =`, which is awkward under ESM + bundler
// moduleResolution. We keep the DB handle loosely typed here and verify
// behavior through the shared repository contract test suite.

export interface Persistence {
  load(): Promise<Uint8Array | undefined>;
  save(data: Uint8Array, expected?: Uint8Array): Promise<void>;
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, projectId TEXT, parentId TEXT, title TEXT, sortOrder INTEGER,
  nodeTimeMode TEXT, nodeTime TEXT, completedAt TEXT, progressNote TEXT,
  repeatRule TEXT DEFAULT 'none', repeatAnchor TEXT, description TEXT, tags TEXT, deletedAt TEXT, createdAt TEXT, updatedAt TEXT
);`;

const COLS =
  'id, projectId, parentId, title, sortOrder, nodeTimeMode, nodeTime, completedAt, progressNote, repeatRule, repeatAnchor, description, tags, deletedAt, createdAt, updatedAt';

const PLACEHOLDERS = COLS.split(', ').map(() => '?').join(',');

// INSERT OR REPLACE would delete + reinsert the row, which moves it to the end of
// the table and reshuffles the project's item order. Upsert keeps the row in place.
const UPSERT_SQL = `INSERT INTO nodes (${COLS}) VALUES (${PLACEHOLDERS})
  ON CONFLICT(id) DO UPDATE SET ${COLS.split(', ').filter(col => col !== 'id').map(col => `${col}=excluded.${col}`).join(', ')}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type DB = any;

function objToNode(o: Record<string, any>): Node {
  return {
    id: o.id,
    projectId: o.projectId,
    parentId: o.parentId ?? null,
    title: o.title,
    sortOrder: o.sortOrder,
    nodeTimeMode: o.nodeTimeMode,
    nodeTime: o.nodeTime ?? null,
    completedAt: o.completedAt ?? null,
    deletedAt: o.deletedAt ?? null,
    progressNote: o.progressNote ?? null,
    description: o.description ?? null,
    tags: o.tags ? JSON.parse(o.tags) : [],
    repeatRule: o.repeatRule ?? 'none',
    repeatAnchor: o.repeatAnchor ?? null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

// Cache the (heavy) WASM compile across instances.
let sqlPromise: Promise<any> | null = null;

async function resolveLocateFile(): Promise<(f: string) => string> {
  // Browser: Vite and Webpack emit the WASM as a local asset. Node tests use
  // a file path because sql.js reads it with fs outside the browser.
  if (typeof window === 'undefined' && typeof process !== 'undefined') {
    const { createRequire } = await import(/* webpackIgnore: true */ 'module');
    const path = await import(/* webpackIgnore: true */ 'node:path');
    const req = createRequire(import.meta.url);
    const distDir = path.dirname(req.resolve('sql.js'));
    return (f) => path.join(distDir, f);
  }
  return () => new URL('../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url).href;
}

function getSql(): Promise<any> {
  if (!sqlPromise) {
    sqlPromise = (async () => initSqlJs({ locateFile: await resolveLocateFile() }))();
  }
  return sqlPromise;
}

export class SqliteRepository implements NodeRepository {
  private db!: DB;
  private ready: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private persisted?: Uint8Array;

  constructor(private persistence: Persistence = idbPersistence()) {
    this.ready = this.init();
    // Initialization is reported by the page when it first reads the repository.
    void this.ready.catch(() => {});
  }

  private async init(): Promise<void> {
    const SQL = await getSql();
    const persisted = await this.persistence.load();
    this.persisted = persisted;
    this.db = persisted ? new SQL.Database(persisted) : new SQL.Database();
    this.db.run(TABLE_SQL);

    // --- schema migration: detect old schema (had `type` column, no `nodeTime`) ---
    const cols = this.queryObjects(`PRAGMA table_info(nodes)`, []);
    const colNames = cols.map((c) => c.name as string);
    if (colNames.includes('type') && !colNames.includes('nodeTime')) {
      this.db.run('ALTER TABLE nodes RENAME TO nodes_legacy');
      this.db.run(TABLE_SQL);
      this.db.run(`INSERT INTO nodes (${COLS}) SELECT
        id, projectId, parentId, title, sortOrder, nodeTimeMode,
        COALESCE(manualNodeTime, itemNodeTime), completedAt, progressNote,
        'none', NULL, NULL, '[]', NULL, createdAt, updatedAt FROM nodes_legacy`);
      this.db.run('DROP TABLE nodes_legacy');
      await this.sync();
    } else {
      if (!colNames.includes('repeatRule')) this.db.run("ALTER TABLE nodes ADD COLUMN repeatRule TEXT DEFAULT 'none'");
      if (!colNames.includes('repeatAnchor')) this.db.run('ALTER TABLE nodes ADD COLUMN repeatAnchor TEXT');
      if (!colNames.includes('description')) this.db.run('ALTER TABLE nodes ADD COLUMN description TEXT');
      if (!colNames.includes('tags')) this.db.run('ALTER TABLE nodes ADD COLUMN tags TEXT');
      if (!colNames.includes('deletedAt')) this.db.run('ALTER TABLE nodes ADD COLUMN deletedAt TEXT');
    }
  }

  private async ensure(): Promise<void> {
    await this.ready;
    await this.writes;
  }

  private async sync(): Promise<void> {
    const data = this.db.export() as Uint8Array;
    await this.persistence.save(data, this.persisted);
    this.persisted = data;
  }

  private async write(change: () => void): Promise<void> {
    await this.ready;
    const operation = this.writes.then(async () => {
      const before = this.db.export() as Uint8Array;
      this.db.run('BEGIN');
      try {
        change();
        this.db.run('COMMIT');
        await this.sync();
      } catch (error) {
        // sql.js exports only committed data. Restore the committed snapshot
        // on both SQL failure and persistence failure before another write.
        this.db.close();
        const SQL = await getSql();
        this.db = new SQL.Database(before);
        const failure = new Error(error instanceof Error ? error.message : '无法保存本机数据，请重试');
        failure.name = 'NoteStorageError';
        throw failure;
      }
    });
    this.writes = operation.catch(() => {});
    await operation;
  }

  private queryObjects(sql: string, params: any[]): Record<string, any>[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  async loadProject(projectId: string): Promise<Node[]> {
    await this.ensure();
    return this.queryObjects(`SELECT ${COLS} FROM nodes WHERE projectId = ?`, [projectId]).map(objToNode);
  }

  async upsertNode(n: Node): Promise<void> {
    await this.write(() => this.db.run(UPSERT_SQL, nodeParams(n)));
  }

  async deleteNode(id: string): Promise<void> {
    await this.write(() => {
      const toDelete: string[] = [id];
      let frontier: string[] = [id];
      while (frontier.length) {
        const ph = frontier.map(() => '?').join(',');
        const kids = this.queryObjects(`SELECT id FROM nodes WHERE parentId IN (${ph})`, frontier).map(
          (r) => r.id as string,
        );
        toDelete.push(...kids);
        frontier = kids;
      }
      const ph = toDelete.map(() => '?').join(',');
      this.db.run(`DELETE FROM nodes WHERE id IN (${ph})`, toDelete);
    });
  }

  async saveProjectTree(nodes: Node[]): Promise<void> {
    await this.write(() => {
      const pid = nodes.find((n) => n.parentId == null)?.id;
      if (pid) this.db.run(`DELETE FROM nodes WHERE projectId = ?`, [pid]);
      for (const n of nodes) this.db.run(UPSERT_SQL, nodeParams(n));
    });
  }

  async replaceAll(nodes: Node[]): Promise<void> {
    await this.write(() => {
      this.db.run('DELETE FROM nodes');
      for (const node of nodes) this.db.run(`INSERT INTO nodes (${COLS}) VALUES (${PLACEHOLDERS})`, nodeParams(node));
    });
  }

  async listProjects(): Promise<Node[]> {
    await this.ensure();
    return this.queryObjects(`SELECT ${COLS} FROM nodes WHERE parentId IS NULL ORDER BY createdAt`, []).map(objToNode);
  }
}

function nodeParams(n: Node): any[] {
  return [
    n.id, n.projectId, n.parentId, n.title, n.sortOrder, n.nodeTimeMode,
    n.nodeTime, n.completedAt, n.progressNote, n.repeatRule, n.repeatAnchor, n.description ?? null, JSON.stringify(n.tags ?? []), n.deletedAt ?? null, n.createdAt, n.updatedAt,
  ];
}

/** Browser IndexedDB persistence. Read and write errors never mean an empty/saved database. */
export function idbPersistence(
  dbName = 'smart-note',
  store = 'kv',
  key = 'smart-note.sqlite',
): Persistence {
  const failure = (message: string) => {
    const error = new Error(message);
    error.name = 'NoteStorageError';
    return error;
  };
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(failure('当前浏览器无法使用本地存储，请更换浏览器；不要清除原站点数据'));
      return;
    }
    let blocked = false;
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result); };
    req.onerror = () => reject(failure('无法打开本机数据，请重试；不要清除站点数据'));
    req.onblocked = () => { blocked = true; reject(failure('请关闭其他备忘录页面后重试')); };
  });
  return {
    async load(): Promise<Uint8Array | undefined> {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const get = tx.objectStore(store).get(key);
        let result: Uint8Array | undefined;
        get.onsuccess = () => { result = get.result; };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onabort = () => { db.close(); reject(failure('无法读取本机数据，请重试；不要清除站点数据')); };
        tx.onerror = () => {};
      });
    },
    async save(data: Uint8Array, expected?: Uint8Array): Promise<void> {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const st = tx.objectStore(store);
        let conflict = false;
        const get = st.get(key);
        get.onsuccess = () => {
          const current = get.result as Uint8Array | undefined;
          const same = current === undefined ? expected === undefined
            : expected !== undefined && current.length === expected.length && current.every((value, index) => value === expected[index]);
          if (!same) { conflict = true; tx.abort(); return; }
          st.put(data, key);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => {
          db.close();
          reject(failure(conflict ? '数据已在其他页面更新，请刷新后再编辑' : '无法保存本机数据，请重试或导出备份'));
        };
        tx.onerror = () => {};
      });
    },
  };
}
