import { Node, NodeTimeMode, RepeatRule } from '../domain/node';
import { NodeRepository } from '../repository/types';
import { nextRepeatDate } from '../domain/repeat';
import { duplicateSubtree } from '../domain/duplicate';
import { leafIds } from '../domain/aggregate';
import { Tree } from '../domain/tree';

export type IdGen = () => string;

export class NodeService {
  constructor(private repo: NodeRepository, private idGen: IdGen) {}

  async createNode(input: {
    projectId: string;
    parentId: string;
    title: string;
    now: string;
    nodeTime?: string | null;
    progressNote?: string | null;
    repeatRule?: RepeatRule;
    repeatAnchor?: string | null;
  }): Promise<Node> {
    const parent = await this.get(input.parentId);
    const node: Node = {
      id: this.idGen(),
      projectId: input.projectId,
      parentId: input.parentId,
      title: input.title,
      sortOrder: 0,
      nodeTimeMode: 'auto',
      nodeTime: input.nodeTime ?? null,
      completedAt: null,
      deletedAt: null,
      progressNote: input.progressNote ?? null,
      description: null,
      tags: [],
      repeatRule: input.repeatRule ?? 'none',
      repeatAnchor: input.repeatAnchor ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    await this.repo.upsertNode(node);
    // 父级一旦有了子节点就不再是叶子：它自己的完成标志不再算数，直接清掉，
    // 免得数据库里留着一份和叶子算出来的结果打架的旧状态。
    if (parent.completedAt) await this.repo.upsertNode({ ...parent, completedAt: null, updatedAt: input.now });
    return node;
  }

  async updateNode(
    id: string,
    patch: Partial<Pick<Node, 'title' | 'nodeTime' | 'nodeTimeMode' | 'progressNote' | 'description' | 'tags' | 'repeatRule' | 'repeatAnchor'>>,
    now: string,
  ): Promise<Node> {
    const cur = await this.get(id);
    const next: Node = { ...cur, ...patch, updatedAt: now };
    await this.repo.upsertNode(next);
    return next;
  }

  async markComplete(id: string, completed: boolean, now: string): Promise<Node> {
    const cur = await this.get(id);
    const recurring = completed && !cur.completedAt && cur.repeatRule !== 'none';
    const next: Node = { ...cur, completedAt: completed ? now : null, repeatRule: recurring ? 'none' : cur.repeatRule, updatedAt: now };
    if (recurring) {
      const today = new Date(now);
      const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const due = cur.nodeTime ?? localDay;
      const repeatAnchor = cur.repeatAnchor ?? due;
      const following: Node = {
        ...cur,
        id: this.idGen(),
        nodeTime: nextRepeatDate(due, repeatAnchor, cur.repeatRule, localDay),
        repeatAnchor,
        progressNote: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const tree = await this.repo.loadProject(cur.projectId);
      await this.repo.saveProjectTree([...tree.map(node => node.id === id ? next : node), following]);
    } else await this.repo.upsertNode(next);
    return next;
  }

  /**
   * 完成 / 取消完成一块子树：只写叶子节点自己的状态，父级不存完成状态。
   * 传进来的 id 自己没有子节点时，它就是那一片叶子。
   */
  async setSubtreeCompletion(id: string, completed: boolean, now: string): Promise<void> {
    const cur = await this.get(id);
    const nodes = await this.repo.loadProject(cur.projectId);
    const ids = new Set(leafIds(new Tree(nodes), id));
    const touched = nodes.filter(node => ids.has(node.id) && !!node.completedAt !== completed);
    if (!touched.length) return;
    // 重复事项完成后要生成下一次，这几片叶子还是走 markComplete。
    const repeating = completed ? touched.filter(node => node.repeatRule !== 'none') : [];
    const plain = touched.filter(node => !repeating.includes(node));
    if (plain.length) {
      const plainIds = new Set(plain.map(node => node.id));
      await this.repo.saveProjectTree(nodes.map(node => plainIds.has(node.id) ? { ...node, completedAt: completed ? now : null, updatedAt: now } : node));
    }
    for (const node of repeating) await this.markComplete(node.id, completed, now);
  }

  /** Set node time mode: 'manual' to override aggregation, 'auto' to derive from children. */
  async setNodeTimeMode(id: string, mode: NodeTimeMode, now: string): Promise<Node> {
    const cur = await this.get(id);
    const next: Node = { ...cur, nodeTimeMode: mode, updatedAt: now };
    await this.repo.upsertNode(next);
    return next;
  }

  /** 复制节点及其全部下级，新节点挂在同一个父级下。 */
  async duplicateNode(id: string, now: string): Promise<Node> {
    const cur = await this.get(id);
    const tree = await this.repo.loadProject(cur.projectId);
    const { root, copies } = duplicateSubtree(tree, id, `${cur.title}（副本）`, now, this.idGen);
    await this.repo.saveProjectTree([...tree, ...copies]);
    return root;
  }

  async deleteNode(id: string): Promise<void> {
    await this.repo.deleteNode(id);
  }

  async getById(id: string): Promise<Node> {
    return this.get(id);
  }

  private async get(id: string): Promise<Node> {
    for (const p of await this.repo.listProjects()) {
      const tree = await this.repo.loadProject(p.projectId);
      const n = tree.find((x) => x.id === id);
      if (n) return n;
    }
    throw new Error(`node ${id} not found`);
  }
}
