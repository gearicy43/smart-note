export type NodeTimeMode = 'auto' | 'manual';
export type RepeatRule = 'none' | 'weekly' | 'monthly';

/**
 * A single node in a project tree.
 *
 * There is no `type` field — every node is the same kind of entity.
 * Whether a node behaves as a "container" (大项) or a "leaf" (小项) is
 * determined dynamically by whether it has children, not by a stored label.
 * The project root is simply the node whose `parentId` is null.
 */
export interface Node {
  id: string;
  projectId: string;
  parentId: string | null; // null = project root
  title: string; // the content / name of the node — that's all it "is"
  sortOrder: number;
  nodeTimeMode: NodeTimeMode; // groups: auto from children or manual override
  nodeTime: string | null; // ISO date; optional project deadline, leaf date, or group override
  completedAt: string | null; // ISO datetime — only meaningful for leaf nodes
  deletedAt: string | null; // soft delete: only set on project roots, the whole tree stays intact
  progressNote: string | null; // optional free-text progress note
  description?: string | null;
  tags?: string[];
  repeatRule: RepeatRule;
  repeatAnchor: string | null; // original due date keeps monthly dates stable at month end
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeArgs {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  now: string;
  nodeTime?: string | null;
  progressNote?: string | null;
  repeatRule?: RepeatRule;
  repeatAnchor?: string | null;
}

export function createNode(args: CreateNodeArgs): Node {
  return {
    id: args.id,
    projectId: args.projectId,
    parentId: args.parentId,
    title: args.title,
    sortOrder: 0,
    nodeTimeMode: 'auto',
    nodeTime: args.nodeTime ?? null,
    completedAt: null,
    deletedAt: null,
    progressNote: args.progressNote ?? null,
    description: null,
    tags: [],
    repeatRule: args.repeatRule ?? 'none',
    repeatAnchor: args.repeatAnchor ?? null,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

/** Convenience for creating a project root (parentId === null, projectId === own id). */
export function createProject(args: { id: string; title: string; now: string; progressNote?: string | null }): Node {
  return createNode({ ...args, projectId: args.id, parentId: null });
}
