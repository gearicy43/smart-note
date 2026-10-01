import { Node } from './node';

export function duplicateProjectTree(
  nodes: Node[],
  newTitle: string,
  now: string,
  idGen: () => string,
): Node[] {
  const root = nodes.find((n) => n.parentId == null);
  if (!root) throw new Error('no project root to duplicate');

  const idMap = new Map<string, string>();
  for (const n of nodes) idMap.set(n.id, idGen());
  const newRootId = idMap.get(root.id)!;

  return nodes.map((n) => {
    const copy: Node = {
      ...n,
      id: idMap.get(n.id)!,
      projectId: newRootId,
      parentId: n.parentId == null ? null : idMap.get(n.parentId)!,
      completedAt: null, // reset execution state
      deletedAt: null, // a copy is always live
      createdAt: now,
      updatedAt: now,
    };
    if (n.id === root.id) copy.title = newTitle;
    return copy;
  });
}

/** 复制某个节点及其所有下级，挂回原来的父级下面。 */
export function duplicateSubtree(
  nodes: Node[],
  rootId: string,
  newTitle: string,
  now: string,
  idGen: () => string,
): { root: Node; copies: Node[] } {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId != null && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }

  const idMap = new Map<string, string>();
  for (const n of nodes) if (ids.has(n.id)) idMap.set(n.id, idGen());

  const copies = nodes.filter((n) => ids.has(n.id)).map((n) => {
    const copy: Node = {
      ...n,
      id: idMap.get(n.id)!,
      parentId: n.id === rootId ? n.parentId : idMap.get(n.parentId!)!,
      completedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (n.id === rootId) copy.title = newTitle;
    return copy;
  });

  return { root: copies.find((n) => n.id === idMap.get(rootId)!)!, copies };
}
