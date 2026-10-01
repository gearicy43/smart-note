import { Node } from './node';

export function validateTree(nodes: Node[]): string[] {
  const errors: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => n.parentId == null);

  if (roots.length !== 1) {
    errors.push('must have exactly one root node (parentId === null)');
  }

  // dangling parents + projectId consistency
  const rootId = roots[0]?.id;
  for (const n of nodes) {
    if (n.parentId != null && !byId.has(n.parentId)) {
      errors.push(`node ${n.id} references missing parent ${n.parentId}`);
    }
    if (rootId && n.projectId !== rootId) {
      errors.push(`node ${n.id} has wrong projectId`);
    }
  }

  // cycle detection
  for (const start of nodes) {
    const seen = new Set<string>();
    let cur: Node | undefined = start;
    while (cur && cur.parentId != null) {
      if (seen.has(cur.id)) {
        errors.push(`cycle detected at ${cur.id}`);
        break;
      }
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
      if (cur && seen.has(cur.id) && cur.parentId != null) {
        errors.push(`cycle detected at ${cur.id}`);
        break;
      }
    }
  }

  return [...new Set(errors)];
}
