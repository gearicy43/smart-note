import { Node } from '../domain/node';
import { NodeRepository } from './types';

export class InMemoryRepository implements NodeRepository {
  private nodes = new Map<string, Node>();

  async loadProject(projectId: string): Promise<Node[]> {
    return [...this.nodes.values()].filter((n) => n.projectId === projectId);
  }

  async upsertNode(node: Node): Promise<void> {
    this.nodes.set(node.id, node);
  }

  async deleteNode(id: string): Promise<void> {
    const all = [...this.nodes.values()];
    const toDelete = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of all) {
        if (n.parentId != null && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
          toDelete.add(n.id);
          changed = true;
        }
      }
    }
    for (const d of toDelete) this.nodes.delete(d);
  }

  async saveProjectTree(nodes: Node[]): Promise<void> {
    const pid = nodes.find((n) => n.parentId == null)?.id;
    if (pid) {
      for (const id of [...this.nodes.keys()]) {
        if (this.nodes.get(id)?.projectId === pid) this.nodes.delete(id);
      }
    }
    for (const n of nodes) this.nodes.set(n.id, n);
  }

  async replaceAll(nodes: Node[]): Promise<void> {
    this.nodes = new Map(nodes.map(node => [node.id, node]));
  }

  async listProjects(): Promise<Node[]> {
    return [...this.nodes.values()]
      .filter((n) => n.parentId == null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
