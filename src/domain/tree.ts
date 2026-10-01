import { Node } from './node';

export class Tree {
  private byId = new Map<string, Node>();
  private kids = new Map<string, Node[]>();

  constructor(nodes: Node[]) {
    for (const n of nodes) this.byId.set(n.id, n);
    for (const n of nodes) {
      if (n.parentId == null) continue;
      const arr = this.kids.get(n.parentId) ?? [];
      arr.push(n);
      this.kids.set(n.parentId, arr);
    }
    for (const arr of this.kids.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  childrenOf(id: string): Node[] {
    return this.kids.get(id) ?? [];
  }

  /** A node is a leaf when it has no children — this is dynamic, not stored. */
  isLeaf(id: string): boolean {
    return this.childrenOf(id).length === 0;
  }

  get(id: string): Node | undefined {
    return this.byId.get(id);
  }

  root(): Node {
    const r = [...this.byId.values()].find((n) => n.parentId == null);
    if (!r) throw new Error('tree has no root');
    return r;
  }

  all(): Node[] {
    return [...this.byId.values()];
  }
}
