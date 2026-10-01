import { Node } from '../domain/node';

export interface NodeRepository {
  loadProject(projectId: string): Promise<Node[]>;
  upsertNode(node: Node): Promise<void>;
  deleteNode(id: string): Promise<void>; // cascade subtree
  saveProjectTree(nodes: Node[]): Promise<void>;
  replaceAll(nodes: Node[]): Promise<void>;
  listProjects(): Promise<Node[]>; // all root nodes (parentId === null)
}
