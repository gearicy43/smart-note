import initSqlJs from 'sql.js';
import { Node } from '../domain/node';
import { NodeRepository } from './types';

// sql.js ships types via `export =`, which is awkward under ESM + bundler
// moduleResolution. We keep the DB handle loosely typed here and verify
// behavior through the shared repository contract test suite.

export interface Persistence {
  load(): Promise<Uint8Array | undefined>;
  save(data: Uint8Array): Promise<void>;
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

  constructor(private persistence: Persistence = idbPersistence()) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const SQL = await getSql();
    const persisted = await this.persistence.load();
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
  }

  private async sync(): Promise<void> {
    await this.persistence.save(this.db.export() as Uint8Array);
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
    await this.ensure();
    this.db.run(UPSERT_SQL, nodeParams(n));
    await this.sync();
  }

  async deleteNode(id: string): Promise<void> {
    await this.ensure();
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
    await this.sync();
  }

  async saveProjectTree(nodes: Node[]): Promise<void> {
    await this.ensure();
    const pid = nodes.find((n) => n.parentId == null)?.id;
    if (pid) this.db.run(`DELETE FROM nodes WHERE projectId = ?`, [pid]);
    for (const n of nodes) this.db.run(UPSERT_SQL, nodeParams(n));
    await this.sync();
  }

  async replaceAll(nodes: Node[]): Promise<void> {
    await this.ensure();
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM nodes');
      for (const node of nodes) this.db.run(`INSERT INTO nodes (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, nodeParams(node));
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
    await this.sync();
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

/** Browser IndexedDB persistence (default). No-ops when indexedDB is unavailable. */
export function idbPersistence(
  dbName = 'smart-note',
  store = 'kv',
  key = 'smart-note.sqlite',
): Persistence {
  return {
    async load(): Promise<Uint8Array | undefined> {
      if (typeof indexedDB === 'undefined') return undefined;
      return new Promise((resolve) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onsuccess = () => {
          const get = req.result.transaction(store).objectStore(store).get(key);
          get.onsuccess = () => resolve(get.result as Uint8Array | undefined);
          get.onerror = () => resolve(undefined);
        };
        req.onerror = () => resolve(undefined);
      });
    },
    async save(data: Uint8Array): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onsuccess = () => {
          const st = req.result.transaction(store, 'readwrite').objectStore(store);
          const put = st.put(data, key);
          put.onsuccess = () => resolve();
          put.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      });
    },
  };
}
